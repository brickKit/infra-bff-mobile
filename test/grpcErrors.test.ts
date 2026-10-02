/**
 * gRPC 下游（mdm-customer / mdm-product）拒绝时客户端看到什么，与 REST 转发同一
 * 套规则：调用者能处理的状态（参数错、token 不被认、没权限、不存在、冲突）以
 * extensions.code 透给客户端，日志记 warn、不记 ERROR（访问日志与指标已经记下
 * 结果，运维不需要为调用者的错误做任何事）；其余状态（下游不可用、内部错误）
 * 对客户端显示为通用错误，不外泄下游细节。
 */

import * as grpc from "@grpc/grpc-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errorLogLines,
  logsAfter,
  grpcError,
  startBff,
  startProductGrpcStub,
  type BffProcess,
  type GrpcStub,
} from "./harness.js";

const SEARCH = `query S($keyword: String!) { searchProducts(keyword: $keyword) { nextCursor } }`;
const PRODUCT = `query P($id: ID!) { product(id: $id) { id } }`;

// 按 keyword 决定桩回哪个 gRPC 状态，一个桩覆盖全部情形。
const STATUS_BY_KEYWORD: Record<string, grpc.status> = {
  bad: grpc.status.INVALID_ARGUMENT,
  authn: grpc.status.UNAUTHENTICATED,
  deny: grpc.status.PERMISSION_DENIED,
  stale: grpc.status.ABORTED,
  down: grpc.status.UNAVAILABLE,
};

let product: GrpcStub;
let bff: BffProcess;

beforeAll(async () => {
  product = await startProductGrpcStub({
    List: (req) => {
      throw grpcError(STATUS_BY_KEYWORD[String(req.q)] ?? grpc.status.INTERNAL, "下游内部细节");
    },
    BatchGet: () => {
      throw grpcError(grpc.status.UNAUTHENTICATED, "下游内部细节");
    },
  });
  bff = await startBff({
    endpoints: { MDM_PRODUCT_ENDPOINT: "http://127.0.0.1:1", MDM_PRODUCT_GRPC_ENDPOINT: product.url },
    queries: [SEARCH, PRODUCT],
    roles: { viewer: ["infra.bff-mobile.product.view"] },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await product?.close();
});

async function search(keyword: string) {
  const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
  return bff.run(SEARCH, { token, variables: { keyword } });
}

describe("gRPC 下游拒绝的透传", () => {
  it.each([
    ["bad", "BAD_USER_INPUT", "INVALID_ARGUMENT"],
    ["authn", "UNAUTHENTICATED", "UNAUTHENTICATED"],
    ["deny", "FORBIDDEN", "PERMISSION_DENIED"],
    ["stale", "CONFLICT", "ABORTED"],
  ])("List 回 %s：字段错误带 %s，日志写明依赖、方法与状态，且不是 ERROR", async (keyword, code, grpcCode) => {
    const before = bff.logs().length;
    const res = await search(keyword);
    expect(res.body.errors?.[0]?.path).toEqual(["searchProducts"]);
    expect(res.body.errors?.[0]?.extensions?.code).toBe(code);
    expect(res.body.errors?.[0]?.extensions?.downstreamGrpcCode).toBe(grpcCode);
    expect(JSON.stringify(res.body)).not.toContain("下游内部细节");
    const after = await logsAfter(bff, before, `mdm/product List 返回 ${grpcCode}`);
    expect(after).toContain(`mdm/product List 返回 ${grpcCode}`);
    expect(errorLogLines(after)).toEqual([]);
  });

  it("BatchGet（经 DataLoader）回 UNAUTHENTICATED：product 字段错误带 UNAUTHENTICATED", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const before = bff.logs().length;
    const res = await bff.run(PRODUCT, { token, variables: { id: "p1" } });
    expect(res.body.errors?.[0]?.path).toEqual(["product"]);
    expect(res.body.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect(errorLogLines(bff.logs().slice(before))).toEqual([]);
  });

  it("下游不可用：客户端只看到通用错误，看不到下游细节；日志里有依赖、方法与状态", async () => {
    const before = bff.logs().length;
    const res = await search("down");
    expect(res.body.errors?.[0]?.message).toBe("Unexpected error.");
    expect(JSON.stringify(res.body)).not.toContain("下游内部细节");
    expect(await logsAfter(bff, before, "mdm/product List 返回 UNAVAILABLE")).toContain("mdm/product List 返回 UNAVAILABLE");
  });
});
