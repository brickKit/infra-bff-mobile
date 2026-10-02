/**
 * 端到端：被测进程与单元测试同一条路径（`test/harness.ts`：真实子进程跑
 * `src/main.ts`、临时工作目录、空闲端口、仓库里的清单一个字节都不碰），但
 * 下游、JWKS、授权包全部是真实在跑的组件，token 是真实登录拿到的用户 token。
 * 证明的是整条链路：真 token 被本组件验签、按真授权包放行，原样转发后下游也认，
 * 数据从真实的 gRPC / REST 回来。清单经配置键 `PERSISTED_OPERATIONS_JSON` 给
 * （与部署时 `file://` 的路径一样）。
 *
 * 变量（`make test-e2e` 缺任何一个必填变量时点名失败，不是全部 SKIP 显示通过）：
 *   必填
 *     TEST_TOKEN                      真实用户的应用 token（如 dev.superuser；只读，不写进任何文件）
 *     TEST_IAM_JWKS_URL               本机进程可达的 JWKS 地址（真实 IAM）
 *     TEST_AUTHZ_BUNDLE_URL           本机进程可达的授权包地址（真实 authz）
 *     TEST_MDM_PRODUCT_GRPC_ENDPOINT  mdm/product 的 gRPC 地址（searchProducts）
 *     TEST_ERP_INVENTORY_ENDPOINT     erp/inventory 的 HTTP 地址（warehouses）
 *     TEST_INFRA_WORKFLOW_ENDPOINT    infra/workflow 的 HTTP 地址（task、myTasks）
 *   可选
 *     TEST_SEARCH_KEYWORD             给了就要求 searchProducts 至少找到一个、每个的 sku 或名称都含它
 *                                     （不给只验形状：关键字 "a"，可能一个都找不到）
 *   可选依赖（给了就验它的字段，没给就验"字段不在 schema 里"）
 *     TEST_INFRA_NOTIFICATION_ENDPOINT、TEST_CRM_OPPORTUNITY_ENDPOINT、
 *     TEST_MDM_CUSTOMER_GRPC_ENDPOINT、TEST_ERP_SALES_ENDPOINT
 *   地址都带 scheme（`http://host:port`），与平台注入的 `*_ENDPOINT` 同形。
 *
 * 另有一个进程只注入必填的三个下游：可选依赖缺席时，对应字段不在 schema 里
 * （查询被校验拒绝），其余字段照常工作。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256, startBff, type BffProcess, type GraphQLResult } from "./harness.js";

const env = (k: string) => process.env[k] ?? "";
const TOKEN = env("TEST_TOKEN");
const REQUIRED = [
  "TEST_TOKEN",
  "TEST_IAM_JWKS_URL",
  "TEST_AUTHZ_BUNDLE_URL",
  "TEST_MDM_PRODUCT_GRPC_ENDPOINT",
  "TEST_ERP_INVENTORY_ENDPOINT",
  "TEST_INFRA_WORKFLOW_ENDPOINT",
];
const HAS_FIXTURES = REQUIRED.every((k) => env(k) !== "");

// 平台变量名 → 测试变量名。product / customer 的 HTTP 端口本组件不用，但平台
// 会注入，缺了它 `resolveAvailableDependencies` 会把整个依赖当成缺席，所以同一个地址也给一份。
const REQUIRED_ENDPOINTS: Record<string, string> = {
  MDM_PRODUCT_ENDPOINT: env("TEST_MDM_PRODUCT_GRPC_ENDPOINT"),
  MDM_PRODUCT_GRPC_ENDPOINT: env("TEST_MDM_PRODUCT_GRPC_ENDPOINT"),
  ERP_INVENTORY_ENDPOINT: env("TEST_ERP_INVENTORY_ENDPOINT"),
  INFRA_WORKFLOW_ENDPOINT: env("TEST_INFRA_WORKFLOW_ENDPOINT"),
};
const OPTIONAL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  Object.entries({
    INFRA_NOTIFICATION_ENDPOINT: env("TEST_INFRA_NOTIFICATION_ENDPOINT"),
    CRM_OPPORTUNITY_ENDPOINT: env("TEST_CRM_OPPORTUNITY_ENDPOINT"),
    MDM_CUSTOMER_ENDPOINT: env("TEST_MDM_CUSTOMER_GRPC_ENDPOINT"),
    MDM_CUSTOMER_GRPC_ENDPOINT: env("TEST_MDM_CUSTOMER_GRPC_ENDPOINT"),
    ERP_SALES_ENDPOINT: env("TEST_ERP_SALES_ENDPOINT"),
  }).filter(([, v]) => v !== ""),
);
const HAS_NOTIFICATION = "INFRA_NOTIFICATION_ENDPOINT" in OPTIONAL_ENDPOINTS;
const HAS_OPPORTUNITY = "CRM_OPPORTUNITY_ENDPOINT" in OPTIONAL_ENDPOINTS;
const HAS_CUSTOMER = "MDM_CUSTOMER_GRPC_ENDPOINT" in OPTIONAL_ENDPOINTS;
const HAS_SALES = "ERP_SALES_ENDPOINT" in OPTIONAL_ENDPOINTS;

const SEARCH = `query SearchProducts($keyword: String!) { searchProducts(keyword: $keyword, pageSize: 5) { products { id sku name status standardCost } nextCursor } }`;
const WAREHOUSES = `query Warehouses { warehouses { id code name status } }`;
const TASK = `query Task($id: ID!) { task(id: $id) { id type status title actions { action actorSub } } }`;
const MY_TASKS = `query MyTasks { myTasks(pageSize: 5) { tasks { id status title } nextCursor } }`;
const MY_NOTIFICATIONS = `query MyNotifications { myNotifications(pageSize: 5) { notifications { id category channel title status } nextCursor } }`;
const MY_OPPORTUNITIES = `query MyOpportunities { myOpportunities(pageSize: 5) { opportunities { id name customerName stageName expectedAmount status } nextCursor } }`;
const CUSTOMERS = `query Customers($ids: [ID!]!) { customers(ids: $ids) { id name status } }`;
const MY_ORDERS = `query MyOrders { myOrders(pageSize: 5) { orders { id orderNo status } nextCursor } }`;
const ALL = [SEARCH, WAREHOUSES, TASK, MY_TASKS, MY_NOTIFICATIONS, MY_OPPORTUNITIES, CUSTOMERS, MY_ORDERS];
const MANIFEST = JSON.stringify(Object.fromEntries(ALL.map((q) => [sha256(q), q])));

// 不存在的 id：两边的 id 都是 bigint，所以用数字形状（非数字是 400，不是干净的"查不到"）。
// workflow 对不存在与不在范围内都回 404，本组件映射成 null；BatchGet 缺失的 id 补 null。
const MISSING_ID = "999999999999";

function expectData(res: GraphQLResult, field: string): unknown {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
  return res.body.data?.[field];
}

function expectFieldAbsent(res: GraphQLResult, field: string): void {
  expect(res.body.data ?? null, JSON.stringify(res.body)).toBeNull();
  const messages = (res.body.errors ?? []).map((e) => e.message).join("\n");
  expect(messages).toContain(`Cannot query field "${field}"`);
}

describe.skipIf(!HAS_FIXTURES)("infra-bff-mobile 端到端（真实下游、真实 token）", () => {
  let bff: BffProcess;

  beforeAll(async () => {
    bff = await startBff({
      endpoints: { ...REQUIRED_ENDPOINTS, ...OPTIONAL_ENDPOINTS },
      queries: [],
      roles: {},
      manifestConfig: MANIFEST,
      auth: { jwksUrl: env("TEST_IAM_JWKS_URL"), bundleUrl: env("TEST_AUTHZ_BUNDLE_URL") },
    });
  }, 30_000);

  afterAll(async () => {
    await bff?.close();
  });

  // 授权包是启动后异步拉的：首次请求可能碰上 503，最多等 30 秒
  async function runReady(query: string, variables?: Record<string, unknown>): Promise<GraphQLResult> {
    for (let i = 0; ; i++) {
      const res = await bff.run(query, { token: TOKEN, variables });
      if (res.status !== 503 || i >= 30) return res;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  it("不带 token：HTTP 401", async () => {
    const res = await bff.run(SEARCH, { variables: { keyword: "a" } });
    expect(res.status).toBe(401);
  });

  it("searchProducts：真 token 经 gRPC 打 mdm/product，拿到产品页", async () => {
    const keyword = env("TEST_SEARCH_KEYWORD");
    const page = expectData(await runReady(SEARCH, { keyword: keyword || "a" }), "searchProducts") as {
      products: Array<{ sku: string; name: string; standardCost: string }>;
      nextCursor: string;
    };
    expect(Array.isArray(page.products)).toBe(true);
    for (const p of page.products) expect(p.standardCost).toMatch(/^-?\d+(\.\d+)?$/);
    if (keyword) {
      expect(page.products.length).toBeGreaterThan(0);
      for (const p of page.products) expect(`${p.sku} ${p.name}`.toLowerCase()).toContain(keyword.toLowerCase());
    }
  }, 40_000);

  it("warehouses：REST 转发到 erp/inventory，下游按真 token 的范围回仓库列表", async () => {
    const list = expectData(await runReady(WAREHOUSES), "warehouses");
    expect(Array.isArray(list)).toBe(true);
  }, 40_000);

  it("task(id)：不存在的待办回 null（下游 404），myTasks 回一页", async () => {
    expect(expectData(await runReady(TASK, { id: MISSING_ID }), "task")).toBeNull();
    const page = expectData(await runReady(MY_TASKS), "myTasks") as { tasks: unknown[] };
    expect(Array.isArray(page.tasks)).toBe(true);
  }, 40_000);

  it.runIf(HAS_NOTIFICATION)("myNotifications：REST 转发到 infra/notification", async () => {
    const page = expectData(await runReady(MY_NOTIFICATIONS), "myNotifications") as { notifications: unknown[] };
    expect(Array.isArray(page.notifications)).toBe(true);
  }, 40_000);

  it.runIf(HAS_OPPORTUNITY)("myOpportunities：REST 转发到 crm/opportunity（view=mine）", async () => {
    const page = expectData(await runReady(MY_OPPORTUNITIES), "myOpportunities") as { opportunities: unknown[] };
    expect(Array.isArray(page.opportunities)).toBe(true);
  }, 40_000);

  it.runIf(HAS_CUSTOMER)("customers：gRPC BatchGet 到 mdm/customer，不存在的 id 回 null", async () => {
    const list = expectData(await runReady(CUSTOMERS, { ids: [MISSING_ID] }), "customers");
    expect(list).toEqual([null]);
  }, 40_000);

  it.runIf(HAS_SALES)("myOrders：REST 转发到 erp/sales", async () => {
    const page = expectData(await runReady(MY_ORDERS), "myOrders") as { orders: unknown[] };
    expect(Array.isArray(page.orders)).toBe(true);
  }, 40_000);

  it("不在清单里的哈希：PersistedQueryNotFound", async () => {
    const res = await bff.run(`query Unlisted { warehouses { id } }`, { token: TOKEN });
    expect(res.body.errors?.[0]?.message).toMatch(/PersistedQueryNotFound/);
  });
});

describe.skipIf(!HAS_FIXTURES)("可选依赖缺席（真实下游）", () => {
  let bff: BffProcess;

  beforeAll(async () => {
    bff = await startBff({
      endpoints: REQUIRED_ENDPOINTS,
      queries: [],
      roles: {},
      manifestConfig: MANIFEST,
      auth: { jwksUrl: env("TEST_IAM_JWKS_URL"), bundleUrl: env("TEST_AUTHZ_BUNDLE_URL") },
    });
  }, 30_000);

  afterAll(async () => {
    await bff?.close();
  });

  it("没注入 notification / opportunity / customer / sales：它们的字段不在 schema 里，其余字段照常", async () => {
    let res: GraphQLResult;
    for (let i = 0; ; i++) {
      res = await bff.run(WAREHOUSES, { token: TOKEN });
      if (res.status !== 503 || i >= 30) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(Array.isArray(expectData(res, "warehouses"))).toBe(true);
    expectFieldAbsent(await bff.run(MY_NOTIFICATIONS, { token: TOKEN }), "myNotifications");
    expectFieldAbsent(await bff.run(MY_OPPORTUNITIES, { token: TOKEN }), "myOpportunities");
    expectFieldAbsent(await bff.run(CUSTOMERS, { token: TOKEN, variables: { ids: ["x"] } }), "customers");
    expectFieldAbsent(await bff.run(MY_ORDERS, { token: TOKEN }), "myOrders");
  }, 60_000);
});
