/**
 * 端到端：真实子进程跑 `src/main.ts`（`runStandalone(createModule)`），真实的
 * JWKS 与 bundle 服务器，真实打 `/graphql`，真实调 mdm-customer（gRPC 路径）
 * 与 infra-workflow / erp-sales（REST 转发路径）。单元测试的构造路径测不出
 * "整条链路装起来会不会崩"（例如 grpc-js 拒绝把调用凭据绑到明文通道上，
 * 只有真的发起一次调用才会抛 `Cannot compose insecure credentials`）。
 *
 * `persisted_queries_only` 挡在最前面：直接发裸 `query` 拿到的是
 * `PersistedQueryOnly` 错误，HTTP 状态码仍是 200（查询校验层的拒绝，与鉴权
 * 无关，不能靠状态码区分）。所以先把测试用的查询写进临时的
 * `contracts/persisted-operations.json`（用完恢复成空清单），请求体按 Apollo
 * APQ 格式发 `extensions.persistedQuery.sha256Hash`。
 *
 * 需要本机已经起了 mdm-customer / infra-workflow / erp-sales 的真实容器（地址由
 * 下面的 TEST_* 变量给）；没有这些容器时自动跳过。
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
const ERP_SALES_ENDPOINT = process.env.TEST_ERP_SALES_ENDPOINT ?? "";
const TEST_CUSTOMER_ID = process.env.TEST_CUSTOMER_ID ?? "";
const HAS_FIXTURES = Boolean(
  MDM_CUSTOMER_ENDPOINT && INFRA_WORKFLOW_ENDPOINT && ERP_SALES_ENDPOINT && TEST_CUSTOMER_ID,
);

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
      // 一次 GraphQL 查询同时联动 mdm-customer（gRPC）与 erp-sales（REST 转发）。
      const joinedQuery = `{ customer(id: "${TEST_CUSTOMER_ID}") { id name } order(id: "does-not-exist") { orderNo } }`;

      const originalManifest = await readFile(MANIFEST_PATH, "utf-8");
      await writeFile(
        MANIFEST_PATH,
        JSON.stringify({
          [sha256(customerQuery)]: customerQuery,
          [sha256(tasksQuery)]: tasksQuery,
          [sha256(joinedQuery)]: joinedQuery,
        }),
      );

      const jwks = await startFakeJWKS();
      const bundle = await startFakeBundle({
        mobile_user: [
          "infra.bff-mobile.customer.view",
          "infra.bff-mobile.task.view",
          "infra.bff-mobile.order.view",
        ],
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
            ERP_SALES_ENDPOINT,
            IAM_JWKS_URL: jwks.url,
            AUTHZ_BUNDLE_URL: bundle.url,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        // pino 写 stdout，Yoga 对未捕获异常的打印可能走 stderr：两路都收。
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
        // 这一步证明的是转发本身，不是"拿到我的待办"：假 JWKS 签的 token 只有
        // 本组件信（IAM_JWKS_URL 指向假服务器）；infra-workflow 是真实容器，
        // 用真实 IAM 的 JWKS 验签，认不出它，回一个干净的 401。拿到 401 恰好
        // 说明 Authorization 头确实原样送到了 infra-workflow（它收到 token 并
        // 尝试验签），而不是头没送到或地址拼错连不上。用真实登录拿 token 是
        // 全栈联调的事。
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
        // 下游拒绝的原因写在子进程日志里：断言那里出现的是 401（转发确实发生、
        // 拿到了对方的响应），不是连接被拒绝 / 名称解析失败这类根本没打到
        // infra-workflow 的错误。
        expect(stderr).toContain("infra/workflow /infra/workflow/tasks 返回 401");

        // ⑤ 一次 GraphQL 查询联动 mdm-customer 与 erp-sales：同一个请求里
        // customer 走 gRPC 拿到真实数据，order 走 REST 转发打到 erp-sales，
        // 两条数据路径在同一次执行里都被真实触发。
        const joinedResp = await fetch(graphqlUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: persistedBody(joinedQuery),
        });
        expect(joinedResp.status).toBe(200);
        const joinedBody = (await joinedResp.json()) as {
          data: { customer: { id: string; name: string } | null; order: null } | null;
          errors?: Array<{ path: string[] }>;
        };
        expect(joinedBody.data?.customer?.id).toBe(TEST_CUSTOMER_ID);
        // order 与 ④ 同理：erp-sales 认不出假 token，转发发生但被拒绝；
        // customer 那一半照样返回真实数据，两条路径互不干扰。
        expect(joinedBody.errors?.some((e) => e.path?.[0] === "order")).toBe(true);

        // ⑥ 一个没在清单里的哈希：拒绝，不是"随便什么查询都放行"。
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
