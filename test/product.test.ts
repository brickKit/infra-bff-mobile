/**
 * searchProducts：mdm-product 是 data_scopes: none，走 gRPC List 的 q；用户请求
 * 路径上用 userClient，调用者的 Authorization 进 gRPC metadata。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBff, startProductGrpcStub, type BffProcess, type GrpcStub } from "./harness.js";

const SEARCH = `query S($keyword: String!, $cursor: String, $pageSize: Int) {
  searchProducts(keyword: $keyword, cursor: $cursor, pageSize: $pageSize) { products { id sku name status trackingType createdAt } nextCursor }
}`;

let product: GrpcStub;
let bff: BffProcess;

beforeAll(async () => {
  product = await startProductGrpcStub({
    List: () => ({
      products: [
        {
          id: "p1", sku: "SKU-1", name: "螺丝", categoryId: "c", baseUomId: "u", trackingType: "TRACKING_TYPE_BATCH",
          standardCost: "1.00", status: "PRODUCT_STATUS_ACTIVE", version: 1,
          createdAt: { seconds: 1767225600, nanos: 0 }, updatedAt: { seconds: 1767225600, nanos: 0 },
        },
      ],
      nextCursor: "pc2",
    }),
  });
  bff = await startBff({
    // 可用性看主端口变量，客户端读 gRPC 端口变量：两个都按平台的形状注入
    endpoints: { MDM_PRODUCT_ENDPOINT: "http://127.0.0.1:1", MDM_PRODUCT_GRPC_ENDPOINT: product.url },
    queries: [SEARCH],
    roles: { viewer: ["infra.bff-mobile.product.view"], nobody: [] },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await product?.close();
});

describe("searchProducts", () => {
  it("调 gRPC List，keyword 进 q、分页参数照传，Authorization 进 metadata，枚举前缀剥掉", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(SEARCH, { token, variables: { keyword: "螺", cursor: "pc1", pageSize: 20 } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    const call = product.calls.at(-1)!;
    expect(call.method).toBe("List");
    expect(call.request).toMatchObject({ q: "螺", cursor: "pc1", pageSize: 20 });
    expect(call.authorization).toBe(`Bearer ${token}`);
    expect(res.body.data?.searchProducts).toEqual({
      products: [{ id: "p1", sku: "SKU-1", name: "螺丝", status: "ACTIVE", trackingType: "BATCH",
        createdAt: "2026-01-01T00:00:00.000Z" }],
      nextCursor: "pc2",
    });
  });

  it("没有 product.view：HTTP 403，gRPC 收不到调用", async () => {
    const token = await bff.jwks.sign({ sub: "u2", roles: ["nobody"] });
    const before = product.calls.length;
    expect((await bff.run(SEARCH, { token, variables: { keyword: "x" } })).status).toBe(403);
    expect(product.calls.length).toBe(before);
  });

  it("不带 token：HTTP 401", async () => {
    expect((await bff.run(SEARCH, { variables: { keyword: "x" } })).status).toBe(401);
  });
});
