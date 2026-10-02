/**
 * `customers(ids:)` / `products(ids:)` 的 id 个数有上限。这是移动端的边界：不设
 * 上限，一个请求带上万个 id，就扇出成一次同样大的 gRPC BatchGet（mdm-customer /
 * mdm-product 的 BatchGet 本身不限个数），armor 的成本限制也不按列表参数的长度
 * 计。超过上限时字段报 BAD_USER_INPUT，不调下游；上限写在 schema 的字段说明里，
 * 前端看 introspection 就知道。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BATCH_IDS } from "../src/limits.js";
import {
  errorLogLines,
  startBff,
  startCustomerGrpcStub,
  startProductGrpcStub,
  type BffProcess,
  type GrpcStub,
} from "./harness.js";

const CUSTOMERS = `query Customers($ids: [ID!]!) { customers(ids: $ids) { id } }`;
const PRODUCTS = `query Products($ids: [ID!]!) { products(ids: $ids) { id } }`;

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

let customer: GrpcStub;
let product: GrpcStub;
let bff: BffProcess;

beforeAll(async () => {
  customer = await startCustomerGrpcStub({ BatchGet: (req) => ({ customers: [], missingIds: req.ids }) });
  product = await startProductGrpcStub({ BatchGet: (req) => ({ products: [], missingIds: req.ids }) });
  bff = await startBff({
    endpoints: {
      MDM_CUSTOMER_ENDPOINT: "http://127.0.0.1:1",
      MDM_CUSTOMER_GRPC_ENDPOINT: customer.url,
      MDM_PRODUCT_ENDPOINT: "http://127.0.0.1:1",
      MDM_PRODUCT_GRPC_ENDPOINT: product.url,
    },
    queries: [CUSTOMERS, PRODUCTS],
    roles: { viewer: ["infra.bff-mobile.customer.view", "infra.bff-mobile.product.view"] },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await customer?.close();
  await product?.close();
});

describe.each([
  ["customers", CUSTOMERS, () => customer],
  ["products", PRODUCTS, () => product],
])("%s(ids:) 的个数上限", (field, query, stub) => {
  it(`恰好 ${MAX_BATCH_IDS} 个：照常一次 BatchGet`, async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const before = stub().calls.length;
    const res = await bff.run(query, { token, variables: { ids: ids(MAX_BATCH_IDS) } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(res.body.data?.[field]).toHaveLength(MAX_BATCH_IDS);
    const calls = stub().calls.slice(before);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.ids).toHaveLength(MAX_BATCH_IDS);
  });

  it(`多一个：字段报 BAD_USER_INPUT，不调下游，不记 ERROR`, async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const before = stub().calls.length;
    const logsBefore = bff.logs().length;
    const res = await bff.run(query, { token, variables: { ids: ids(MAX_BATCH_IDS + 1) } });
    expect(res.status).toBe(200);
    expect(res.body.errors?.[0]?.path).toEqual([field]);
    expect(res.body.errors?.[0]?.extensions?.code, JSON.stringify(res.body)).toBe("BAD_USER_INPUT");
    expect(res.body.errors?.[0]?.message).toContain(String(MAX_BATCH_IDS));
    expect(stub().calls.slice(before)).toEqual([]);
    await new Promise((r) => setTimeout(r, 300));
    expect(errorLogLines(bff.logs().slice(logsBefore))).toEqual([]);
  });

  it("没有权限时先报 FORBIDDEN：上限检查不替权限检查说话", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: [] });
    const res = await bff.run(query, { token, variables: { ids: ids(MAX_BATCH_IDS + 1) } });
    expect(res.body.errors?.[0]?.extensions?.code, JSON.stringify(res.body)).toBe("FORBIDDEN");
  });

  it("schema 的字段说明写着同一个上限", () => {
    const sdl = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "contracts/schema.graphql"), "utf-8");
    const description = buildSchema(sdl).getQueryType()?.getFields()[field]?.description ?? "";
    expect(description).toContain(`${MAX_BATCH_IDS}`);
    expect(description).toContain("BAD_USER_INPUT");
  });
});
