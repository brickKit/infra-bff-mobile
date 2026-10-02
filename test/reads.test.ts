/**
 * 通知、库存列表、仓库、商机与订单按客户过滤：都是有真实数据范围的读，REST 转发，
 * 路径与查询参数按下游契约拼，调用者的 Authorization 原样带上——"别人的数据看
 * 不到"由下游的 REST 面判，本组件只负责不绕开它。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBff, startHttpStub, type BffProcess, type HttpStub, type StubRequest } from "./harness.js";

const MY_NOTIFICATIONS = `query N($cursor: String, $pageSize: Int) {
  myNotifications(cursor: $cursor, pageSize: $pageSize) { notifications { id category channel title body status sourceId createdAt } nextCursor }
}`;
const BALANCES = `query B($productId: ID!, $cursor: String, $pageSize: Int) {
  inventoryBalances(productId: $productId, cursor: $cursor, pageSize: $pageSize) { balances { productId warehouseId availableQty } nextCursor }
}`;
const WAREHOUSES = `{ warehouses { id code name status } }`;
const MY_OPPS = `query O($status: OpportunityStatus, $pageSize: Int) {
  myOpportunities(status: $status, pageSize: $pageSize) { opportunities { id name stageName expectedAmount probability status orderId expectedCloseDate wonAt items { productSku qty quotedUnitPrice subtotal } } nextCursor }
}`;
const OPP = `query P($id: ID!) { opportunity(id: $id) { id name customerName orderId } }`;
const MY_ORDERS_BY_CUSTOMER = `query M($customerId: ID) { myOrders(customerId: $customerId) { nextCursor } }`;

const RAW_NOTIFICATION = {
  id: "n1", recipient_sub: "u1", category: "workflow_task", channel: "IM", title: "有新待办", body: "请审批",
  status: "SENT", external_task_id: "ext", source_component: "infra/workflow", source_aggregate: "task",
  source_id: "42", retry_count: 0, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};
const RAW_OPP = {
  id: "op1", name: "大单", customer_id: "c1", customer_name: "某客户", owner_id: "u1", dept_id: "d", dept_path: "/d",
  stage_id: "s2", stage_name: "报价", items: [{ product_id: "p1", product_sku: "SKU-1", product_name: "螺丝", uom_id: "u",
    qty: "10", quoted_unit_price: "1.50", subtotal: "15.00" }],
  expected_amount: "15.00", probability: 40, weighted_amount: "6.00", expected_close_date: "2026-03-01T00:00:00Z",
  status: "OPEN", currency: "CNY", lost_reason: "", won_at: null, order_id: "", version: 3,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
};

function route(req: StubRequest) {
  const url = new URL(req.url, "http://x");
  switch (url.pathname) {
    case "/infra/notification/notifications":
      return { status: 200, body: { records: [RAW_NOTIFICATION], next_cursor: "nc2" } };
    case "/erp/inventory/balances/list":
      return {
        status: 200,
        body: {
          balances: [{ product_id: "p1", warehouse_id: "w1", on_hand_qty: "5", reserved_qty: "1", available_qty: "4", version: 2 }],
          next_cursor: "",
        },
      };
    case "/erp/inventory/warehouses":
      return { status: 200, body: { warehouses: [{ id: "w1", code: "WH1", name: "一号仓", status: "ACTIVE" }] } };
    case "/crm/opportunity/opportunities":
      return { status: 200, body: { opportunities: [RAW_OPP], next_cursor: "oc2" } };
    case "/crm/opportunity/opportunities/op1":
      return { status: 200, body: RAW_OPP };
    case "/erp/sales/orders":
      return { status: 200, body: { orders: [], next_cursor: "" } };
    default:
      return { status: 404, body: {} };
  }
}

let stub: HttpStub;
let bff: BffProcess;
let token: string;

beforeAll(async () => {
  stub = await startHttpStub(route);
  bff = await startBff({
    endpoints: {
      INFRA_NOTIFICATION_ENDPOINT: stub.url,
      ERP_INVENTORY_ENDPOINT: stub.url,
      CRM_OPPORTUNITY_ENDPOINT: stub.url,
      ERP_SALES_ENDPOINT: stub.url,
    },
    queries: [MY_NOTIFICATIONS, BALANCES, WAREHOUSES, MY_OPPS, OPP, MY_ORDERS_BY_CUSTOMER],
    roles: {
      mobile: [
        "infra.bff-mobile.notification.view",
        "infra.bff-mobile.inventory.view",
        "infra.bff-mobile.opportunity.view",
        "infra.bff-mobile.order.view",
      ],
      orders_only: ["infra.bff-mobile.order.view"],
    },
  });
  token = await bff.jwks.sign({ sub: "u1", roles: ["mobile"] });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await stub?.close();
});

const last = () => stub.requests.at(-1)!;

describe("myNotifications", () => {
  it("转发 GET /infra/notification/notifications，分页参数按契约改名，records 映射成 notifications", async () => {
    const res = await bff.run(MY_NOTIFICATIONS, { token, variables: { cursor: "nc1", pageSize: 20 } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(last().url).toBe("/infra/notification/notifications?cursor=nc1&page_size=20");
    expect(last().headers.authorization).toBe(`Bearer ${token}`);
    expect(res.body.data?.myNotifications).toEqual({
      notifications: [{ id: "n1", category: "workflow_task", channel: "IM", title: "有新待办", body: "请审批",
        status: "SENT", sourceId: "42", createdAt: "2026-01-01T00:00:00Z" }],
      nextCursor: "nc2",
    });
  });

  it("没有 notification.view：HTTP 403，下游收不到请求", async () => {
    const other = await bff.jwks.sign({ sub: "u2", roles: ["orders_only"] });
    const before = stub.requests.length;
    const res = await bff.run(MY_NOTIFICATIONS, { token: other });
    expect(res.status).toBe(403);
    expect(stub.requests.length).toBe(before);
  });

  it("不带 token：HTTP 401", async () => {
    expect((await bff.run(MY_NOTIFICATIONS)).status).toBe(401);
  });
});

describe("inventoryBalances / warehouses", () => {
  it("inventoryBalances 转发 GET /erp/inventory/balances/list?product_id=…", async () => {
    const res = await bff.run(BALANCES, { token, variables: { productId: "p1", cursor: "b1", pageSize: 10 } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(last().url).toBe("/erp/inventory/balances/list?product_id=p1&cursor=b1&page_size=10");
    expect(last().headers.authorization).toBe(`Bearer ${token}`);
    expect(res.body.data?.inventoryBalances).toEqual({
      balances: [{ productId: "p1", warehouseId: "w1", availableQty: "4" }],
      nextCursor: "",
    });
  });

  it("warehouses 转发 GET /erp/inventory/warehouses", async () => {
    const res = await bff.run(WAREHOUSES, { token });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(last().url).toBe("/erp/inventory/warehouses");
    expect(res.body.data?.warehouses).toEqual([{ id: "w1", code: "WH1", name: "一号仓", status: "ACTIVE" }]);
  });

  it("没有 inventory.view：两个字段都是 HTTP 403", async () => {
    const other = await bff.jwks.sign({ sub: "u2", roles: ["orders_only"] });
    expect((await bff.run(WAREHOUSES, { token: other })).status).toBe(403);
    expect((await bff.run(BALANCES, { token: other, variables: { productId: "p1" } })).status).toBe(403);
  });
});

describe("myOpportunities / opportunity", () => {
  it("myOpportunities 固定 view=mine，status 按契约改名为 status_filter", async () => {
    const res = await bff.run(MY_OPPS, { token, variables: { status: "OPEN", pageSize: 5 } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(last().url).toBe("/crm/opportunity/opportunities?view=mine&page_size=5&status_filter=OPEN");
    expect(last().headers.authorization).toBe(`Bearer ${token}`);
    expect(res.body.data?.myOpportunities).toEqual({
      opportunities: [{ id: "op1", name: "大单", stageName: "报价", expectedAmount: "15.00", probability: 40,
        status: "OPEN", orderId: "", expectedCloseDate: "2026-03-01T00:00:00Z", wonAt: null,
        items: [{ productSku: "SKU-1", qty: "10", quotedUnitPrice: "1.50", subtotal: "15.00" }] }],
      nextCursor: "oc2",
    });
  });

  it("opportunity(id) 转发 GET /crm/opportunity/opportunities/{id}；查不到返回 null", async () => {
    const found = await bff.run(OPP, { token, variables: { id: "op1" } });
    expect(found.body.data?.opportunity).toEqual({ id: "op1", name: "大单", customerName: "某客户", orderId: "" });
    const missing = await bff.run(OPP, { token, variables: { id: "nope" } });
    expect(missing.body.errors).toBeUndefined();
    expect(missing.body.data?.opportunity).toBeNull();
  });

  it("没有 opportunity.view：HTTP 403", async () => {
    const other = await bff.jwks.sign({ sub: "u2", roles: ["orders_only"] });
    expect((await bff.run(OPP, { token: other, variables: { id: "op1" } })).status).toBe(403);
  });
});

describe("myOrders(customerId)", () => {
  it("customerId 按契约改名为 customer_id", async () => {
    const res = await bff.run(MY_ORDERS_BY_CUSTOMER, { token, variables: { customerId: "c1" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(last().url).toBe("/erp/sales/orders?customer_id=c1");
  });
});
