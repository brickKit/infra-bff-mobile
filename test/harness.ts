/**
 * 对下游用桩的进程级测试夹具：真实子进程跑 `src/main.ts`（与生产同一条
 * `runStandalone` 路径，权限判定是真的），下游是本机起的 HTTP / gRPC 桩，
 * 记录收到的每一个请求。
 *
 * 子进程的工作目录是一个临时目录：里面的 `component.yaml` 换了一个空闲端口
 * （不占 8500，与 e2e 和本机其它进程互不干扰），`contracts/` 里的
 * `schema.graphql` 与 `vendor/` 链接回仓库，`persisted-operations.json` 只装
 * 本次测试要发的查询——仓库里的清单文件一个字节都不碰。清单也可以经配置键
 * `PERSISTED_OPERATIONS_JSON` 给（`manifestConfig`），那时它整份替换文件里的清单。
 *
 * 子进程的环境只给本次要的键，不继承本机终端：终端里残留的 `*_ENDPOINT`
 * 会让"某依赖缺席"的用例悄悄变成"某依赖在场"。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { startFakeBundle, startFakeJWKS, type FakeJWKS } from "./helpers.js";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN_TS = join(PKG_ROOT, "src/main.ts");
const TSX_BIN = join(PKG_ROOT, "node_modules/.bin/tsx");

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForListen(
  port: number,
  deadlineMs: number,
  logs: () => string,
  exited: () => boolean = () => false,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    // 子进程已经退出（例如启动时配置非法）：不用等满超时
    if (exited()) throw new Error(`子进程在开始监听 ${port} 之前退出；子进程输出：\n${logs()}`);
    const ok = await new Promise<boolean>((resolve) => {
      const sock = connect({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`端口 ${port} 在 ${deadlineMs}ms 内没有开始监听；子进程输出：\n${logs()}`);
}

// ─── HTTP 桩 ───

export interface StubRequest {
  method: string;
  /** 路径加查询串，原样（未解码），例如 `/erp/sales/orders/1%3Fx` */
  url: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

export interface StubResponse {
  status: number;
  body?: unknown;
}

export interface HttpStub {
  url: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}

/** 起一个 HTTP 桩：`route` 按请求决定响应，所有请求都记进 `requests`。 */
export async function startHttpStub(route: (req: StubRequest) => StubResponse): Promise<HttpStub> {
  const requests: StubRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      const recorded: StubRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(recorded);
      const { status, body } = route(recorded);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ─── gRPC 桩（mdm-product） ───

export interface GrpcCall {
  method: string;
  request: Record<string, unknown>;
  authorization: string;
}

export interface GrpcStub {
  url: string;
  calls: GrpcCall[];
  close: () => Promise<void>;
}

type UnaryImpl = (request: Record<string, unknown>) => Record<string, unknown>;

/** 让桩回一个 gRPC 错误状态：在 UnaryImpl 里 `throw grpcError(grpc.status.INVALID_ARGUMENT, "…")`。 */
export function grpcError(code: grpc.status, details: string): Partial<grpc.ServiceError> {
  return { code, details, message: details };
}

/**
 * 子进程输出里记成 ERROR 的行：SDK 的 JSON 日志 level 为 error，或 Yoga 自带
 * logger 的 `ERR` 前缀行（Yoga 掩盖意外错误时用它记原始错误）。
 */
export function errorLogLines(logs: string): string[] {
  return logs.split("\n").filter((line) => {
    if (line.includes("ERR\x1b[0m")) return true;
    try {
      const level = (JSON.parse(line) as { level?: unknown }).level;
      return level === "error" || level === 50;
    } catch {
      return false;
    }
  });
}

/**
 * 子进程从 `since`（`logs().length` 的快照）之后的输出，等到里面出现 `text` 再返回，
 * 最多等 `timeoutMs`（等不到就返回当时的输出，交给调用方的断言去报错）。
 * 日志经管道异步到达，可能比 HTTP 响应晚：响应一回来就截取，偶尔截不到这一行。
 */
export async function logsAfter(
  bff: Pick<BffProcess, "logs">,
  since: number,
  text: string,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = bff.logs().slice(since);
    if (out.includes(text) || Date.now() >= deadline) return out;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** 起一个 mdm-product 的 gRPC 桩，只实现 `impl` 里给的方法；proto 用随仓库携带的那份。 */
export async function startProductGrpcStub(impl: Record<string, UnaryImpl>): Promise<GrpcStub> {
  const def = loadSync(join(PKG_ROOT, "contracts/vendor/mdm/product/v1/product.proto"), {
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    mdm: { product: { v1: { ProductService: { service: grpc.ServiceDefinition } } } };
  };
  const calls: GrpcCall[] = [];
  const handlers: grpc.UntypedServiceImplementation = {};
  for (const [method, fn] of Object.entries(impl)) {
    handlers[method] = (call: grpc.ServerUnaryCall<Record<string, unknown>, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      calls.push({
        method,
        request: call.request,
        authorization: String(call.metadata.get("authorization")[0] ?? ""),
      });
      try {
        cb(null, fn(call.request));
      } catch (err) {
        // 桩要回 gRPC 错误时 throw grpcError(...)：带数字 code 的对象原样作为状态回给调用方
        if (err && typeof (err as { code?: unknown }).code === "number") {
          cb(err as grpc.ServiceError);
          return;
        }
        throw err;
      }
    };
  }
  const server = new grpc.Server();
  server.addService(pkg.mdm.product.v1.ProductService.service, handlers);
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (err, p) =>
      err ? reject(err) : resolve(p),
    ),
  );
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.tryShutdown(() => resolve())),
  };
}

// ─── 被测进程 ───

export interface GraphQLResult {
  status: number;
  body: {
    data?: Record<string, unknown> | null;
    errors?: Array<{ message: string; path?: string[]; extensions?: Record<string, unknown> }>;
  };
}

export interface BffProcess {
  jwks: FakeJWKS;
  /** 发一个已登记的持久化查询；`token` 为空时不带 Authorization。 */
  run: (query: string, opts?: { token?: string; variables?: Record<string, unknown> }) => Promise<GraphQLResult>;
  /**
   * 原样 POST 一个请求体（JSON 序列化后发出）：`run` 总是按查询文本算哈希，
   * 测不了"客户端自己挑的哈希"和"带查询文本的请求"，这两类边界用它发。
   */
  post: (body: unknown, opts?: { token?: string }) => Promise<GraphQLResult>;
  /** `/graphql` 的完整地址（测 GET 之类 `post` 覆盖不到的请求形状） */
  graphqlUrl: string;
  logs: () => string;
  close: () => Promise<void>;
}

export interface StartBffOptions {
  /** 注入给子进程的依赖地址，键是平台的变量名（如 `INFRA_WORKFLOW_ENDPOINT`） */
  endpoints: Record<string, string>;
  /** 本次要发的全部查询，写进临时的 persisted-operations.json */
  queries: string[];
  /** bundle 里的角色 → 权限键 */
  roles: Record<string, string[]>;
  /** 给了就作为配置键 PERSISTED_OPERATIONS_JSON 的值原样注入（可以是非法 JSON，测启动失败） */
  manifestConfig?: string;
  /** 给了就用真实的 JWKS / 授权包地址代替本机的假服务器（端到端用；这时 `jwks.sign` 签的 token 不会被认） */
  auth?: { jwksUrl: string; bundleUrl: string };
}

/**
 * 起被测进程。`freePort` 先占后放，到子进程 listen 之间端口可能被别人拿走——
 * 本机任何一条出站连接的临时端口都从同一个范围里分（端到端时被测进程自己
 * 就在连真实下游）。子进程因 EADDRINUSE 退出时换一个端口重来，最多三次。
 */
export async function startBff(opts: StartBffOptions): Promise<BffProcess> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startBffOnce(opts);
    } catch (err) {
      if (attempt >= 3 || !String((err as Error).message).includes("EADDRINUSE")) throw err;
    }
  }
}

async function startBffOnce(opts: StartBffOptions): Promise<BffProcess> {
  const jwks = await startFakeJWKS();
  const bundle = await startFakeBundle(opts.roles);
  const port = await freePort();

  const dir = await mkdtemp(join(tmpdir(), "bff-mobile-test-"));
  const manifest = await readFile(join(PKG_ROOT, "component.yaml"), "utf-8");
  await writeFile(join(dir, "component.yaml"), manifest.replace(/^(\s+port:\s*)8500\s*$/m, `$1${port}`));
  await mkdir(join(dir, "contracts"));
  await symlink(join(PKG_ROOT, "contracts/schema.graphql"), join(dir, "contracts/schema.graphql"));
  await symlink(join(PKG_ROOT, "contracts/vendor"), join(dir, "contracts/vendor"));
  await writeFile(
    join(dir, "contracts/persisted-operations.json"),
    JSON.stringify(Object.fromEntries(opts.queries.map((q) => [sha256(q), q]))),
  );

  let output = "";
  const child: ChildProcess = spawn(TSX_BIN, [MAIN_TS], {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      COMPONENT_ID: "infra/bff-mobile",
      COMPONENT_VERSION: "test",
      IAM_JWKS_URL: opts.auth?.jwksUrl ?? jwks.url,
      AUTHZ_BUNDLE_URL: opts.auth?.bundleUrl ?? bundle.url,
      ...opts.endpoints,
      ...(opts.manifestConfig === undefined ? {} : { PERSISTED_OPERATIONS_JSON: opts.manifestConfig }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c: Buffer) => (output += c.toString()));
  child.stderr?.on("data", (c: Buffer) => (output += c.toString()));

  const logs = () => output;
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  try {
    await waitForListen(port, 15_000, logs, exited);
  } catch (err) {
    child.kill("SIGKILL");
    await jwks.close();
    await bundle.close();
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  const graphqlUrl = `http://127.0.0.1:${port}/graphql`;
  const post = async (body: unknown, postOpts: { token?: string } = {}): Promise<GraphQLResult> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (postOpts.token) headers.authorization = `Bearer ${postOpts.token}`;
    const resp = await fetch(graphqlUrl, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: resp.status, body: (await resp.json()) as GraphQLResult["body"] };
  };
  return {
    jwks,
    logs,
    graphqlUrl,
    post,
    run: (query, runOpts = {}) =>
      post(
        {
          variables: runOpts.variables ?? {},
          extensions: { persistedQuery: { version: 1, sha256Hash: sha256(query) } },
        },
        { token: runOpts.token },
      ),
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
        });
      }
      await jwks.close();
      await bundle.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
