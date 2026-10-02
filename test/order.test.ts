/**
 * erp-sales 的两个查询：路径与查询参数按契约拼，调用者的 Authorization 原样转发。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBff, startHttpStub, type BffProcess, type HttpStub } from "./harness.js";

const ORDER = `query Order($id: ID!) { order(id: $id) { id orderNo } }`;

const RAW_ORDER = {
  id: "7", order_no: "SO-7", customer_id: "c1", customer_name: "客户", status: "DRAFT", items: [],
  total_amount: "0", dept_id: "d", dept_path: "/d", owner_id: "u", reservation_id: "", version: 1,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

let sales: HttpStub;
let bff: BffProcess;

beforeAll(async () => {
  sales = await startHttpStub(() => ({ status: 200, body: RAW_ORDER }));
  bff = await startBff({
    endpoints: { ERP_SALES_ENDPOINT: sales.url },
    queries: [ORDER],
    roles: { viewer: ["infra.bff-mobile.order.view"] },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await sales?.close();
});

describe("order(id)", () => {
  it("id 整段编码进路径：带 ? / # 的 id 不能变成查询参数或别的路径", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(ORDER, { token, variables: { id: "7?view=all#x" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(sales.requests.at(-1)?.url).toBe("/erp/sales/orders/7%3Fview%3Dall%23x");
  });
});
