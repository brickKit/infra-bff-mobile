/**
 * 端到端：真实子进程跑 `src/main.ts`（`runStandalone(createModule)`），
 * 真实 JWKS + bundle 服务器，真实打 `/graphql`，真实调 mdm-customer
 * （gRPC 路径）与 infra-workflow（REST 转发路径）——同 be-sdk-ts
 * `standalone.test.ts` 的既有判据：单元测试的构造路径测不出"整条链路
 * 装起来会不会崩"，这次移植过程中真的靠这个思路在 be-sdk-ts 的
 * client.ts 上抓到一个真实 bug（Cannot compose insecure credentials，
 * 见根 docs/dev/实测踩坑记录.md A11）。
 *
 * ⚠️ 真机验证过一个容易漏想的点：`persisted_queries_only: true`（§11.4.3
 * 强制）挡在最前面——测试第一版直接发裸 `query` 字符串，拿到的是
 * `PersistedQueryOnly` 错误，HTTP 状态码还是 200（这是查询校验层的拒绝，
 * 不是鉴权层的拒绝，两者互不相干，不能靠状态码区分）。所以这里先把
 * 测试用的查询写进一份临时的 `contracts/persisted-operations.json`
 * （用完恢复成真实的空清单），请求体按 Apollo APQ 的既有格式发
 * `extensions.persistedQuery.sha256Hash`，不发裸 `query`。
 *
 * 需要本机已经 `brickkit up` 起了 mdm-customer/infra-workflow 真实容器
 * （见下方 env 硬编码的容器 IP，来自 `docker inspect`）——本地/CI 没有
 * 这些容器时自动跳过。
 */

import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startFakeBundle, startFakeJWKS } from "./helpers.js";

const MDM_CUSTOMER_ENDPOINT = process.env.TEST_MDM_CUSTOMER_ENDPOINT ?? "";
const INFRA_WORKFLOW_ENDPOINT = process.env.TEST_INFRA_WORKFLOW_ENDPOINT ?? "";
const TEST_CUSTOMER_ID = process.env.TEST_CUSTOMER_ID ?? "";
const HAS_FIXTURES = Boolean(MDM_CUSTOMER_ENDPOINT && INFRA_WORKFLOW_ENDPOINT && TEST_CUSTOMER_ID);

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN_TS = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const TSX_BIN = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../contracts/persisted-operations.json", import.meta.url));
const PORT = 8500; // component.yaml 写死的端口，loadOwnPorts 从这份真实文件读

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function persistedBody(queryText: string): string {
  return JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: sha256(queryText) } } });
}

async function waitForListen(port: number, deadlineMs = 8000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
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
  throw new Error(`端口 ${port} 在 ${deadlineMs}ms 内没有开始监听`);
}

describe.skipIf(!HAS_FIXTURES)("infra-bff-mobile 端到端", () => {
  it(
    "真实子进程起服务，401/403/200 三态 + gRPC 与 REST 两条数据路径都真的打通",
    async () => {
      const customerQuery = `{ customer(id: "${TEST_CUSTOMER_ID}") { id name status } }`;
      const tasksQuery = `{ myTasks { tasks { id } nextCursor } }`;

      const originalManifest = await readFile(MANIFEST_PATH, "utf-8");
      await writeFile(
        MANIFEST_PATH,
        JSON.stringify({ [sha256(customerQuery)]: customerQuery, [sha256(tasksQuery)]: tasksQuery }),
      );

      const jwks = await startFakeJWKS();
      const bundle = await startFakeBundle({
        mobile_user: ["infra.bff-mobile.customer.view", "infra.bff-mobile.task.view"],
      });

      let child: ChildProcess | undefined;
      let stderr = "";
      try {
        child = spawn(TSX_BIN, [MAIN_TS], {
          cwd: PKG_ROOT,
          env: {
            ...process.env,
            COMPONENT_ID: "infra/bff-mobile",
            COMPONENT_VERSION: "test",
            MDM_CUSTOMER_ENDPOINT,
            INFRA_WORKFLOW_ENDPOINT,
            IAM_JWKS_URL: jwks.url,
            AUTHZ_BUNDLE_URL: bundle.url,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        // 不确定 Yoga 自己对未捕获 resolver 异常的日志走 stdout 还是
        // stderr（pino 本身配的是 stdout，但 Yoga 内部对这类异常另有
        // 一层 console.error 风格的打印）——两路都收，够用即可，不细究。
        child.stdout?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        await waitForListen(PORT);
        const graphqlUrl = `http://127.0.0.1:${PORT}/graphql`;

        // ① 没带 token：401。
        const noAuthResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: persistedBody(customerQuery),
        });
        expect(noAuthResp.status, `stderr:\n${stderr}`).toBe(401);

        // ② 带 token，但角色没有对应权限键：403。
        const noPermToken = await jwks.sign({ sub: "u1", roles: ["nobody"] });
        const noPermResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${noPermToken}` },
          body: persistedBody(customerQuery),
        });
        expect(noPermResp.status).toBe(403);

        // ③ 有权限：customer 走 gRPC 拿到真实数据。
        const token = await jwks.sign({ sub: "mobile-1", roles: ["mobile_user"] });
        const customerResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: persistedBody(customerQuery),
        });
        expect(customerResp.status).toBe(200);
        const customerBody = (await customerResp.json()) as {
          data?: { customer?: { id: string; status: string } };
          errors?: unknown;
        };
        expect(customerBody.errors, JSON.stringify(customerBody)).toBeUndefined();
        expect(customerBody.data?.customer?.id).toBe(TEST_CUSTOMER_ID);
        expect(customerBody.data?.customer?.status).toBe("ACTIVE");

        // ④ 有权限：myTasks 走 REST 转发，真实打 infra-workflow。
        //
        // ⚠️ 这条真机测试证明的是转发机制本身，不是"拿到我的待办列表"：
        // 本组件用假 JWKS（jwks.sign）签的 token 只对本组件自己可信
        // （iamJwksUrl 指向的就是这个假服务器）；infra-workflow 是真机
        // 部署的真实容器，验签走的是它自己配置的真实 infra-iam-casdoor
        // JWKS，认不出这里签的 token，会给一个干净的 401——这恰好是
        // 想验证的事：Authorization 头**确实原样转发到了 infra-workflow**
        // （它真的收到了一个 token 并尝试验签，不是"头根本没送到"或者
        // "URL 拼错了连不上"），只是两边对 token 的信任根不同这一点，
        // 本测试没有能力（也不需要）用真实 Casdoor 登录去补——那是
        // Task 14 全链路联调时才有意义的事。
        const tasksResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: persistedBody(tasksQuery),
        });
        expect(tasksResp.status).toBe(200); // GraphQL 传输层恒 200，错误在 body.errors 里
        const tasksBody = (await tasksResp.json()) as {
          data: null;
          errors: Array<{ path: string[]; message: string }>;
        };
        expect(tasksBody.errors?.[0]?.path).toEqual(["myTasks"]);
        // 客户端看到的是 Yoga 默认掩盖过的 "Unexpected error."（下游
        // REST 调用失败属于"真正的意外错误"，该被掩盖，同 requirePermission
        // 模块文档说的"401/403 该让调用方看见、未捕获异常该掩盖"是同一
        // 条判据）——真正的根因走 stderr（子进程真实日志），断言那里
        // 出现的是 401（REST 转发确实发生并拿到了服务端响应），不是
        // 连接被拒绝/DNS 解析失败这类"根本没打到 infra-workflow"的错误。
        expect(stderr).toContain("infra/workflow /infra/workflow/tasks 返回 401");

        // ⑤ 一个没在清单里的哈希：拒绝，不是"随便什么查询都放行"。
        const arbitraryResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            extensions: { persistedQuery: { version: 1, sha256Hash: "0".repeat(64) } },
          }),
        });
        const arbitraryBody = (await arbitraryResp.json()) as { errors?: Array<{ message: string }> };
        expect(arbitraryBody.errors?.[0]?.message).toMatch(/PersistedQueryNotFound|not found/i);
      } finally {
        child?.kill("SIGTERM");
        await jwks.close();
        await bundle.close();
        await writeFile(MANIFEST_PATH, originalManifest);
      }
    },
    20_000,
  );
});
