/**
 * mdm-customer/mdm-product 的 gRPC 客户端——真实容器，真实数据。不
 * mock：连的是本机 `brickkit up` 起的真实 mdm-customer-1-0-3/
 * mdm-product-1-0-3 容器。
 *
 * ⚠️ 05b Task 9 真机验证时发现：这两个客户端调 `userClient` 一直漏传
 * `"grpc"` 这个 extra 参数，实际读的是 `MDM_CUSTOMER_ENDPOINT`（主
 * REST 端口 8080）而不是 `MDM_CUSTOMER_GRPC_ENDPOINT`（gRPC 端口
 * 9090）——本文件这条注释此前一直写着把 gRPC 端口地址喂给
 * `MDM_CUSTOMER_ENDPOINT` 这个变量名，凑巧掩盖了这个 bug（真机跑这条
 * 测试时手工把 gRPC 地址塞进了错的变量名，两个错误刚好互相抵消）。
 * `src/clients/customer.ts`/`product.ts` 已经修正为传 `"grpc"`，这里
 * 同步改成平台真实会生成的变量名。
 *
 * 需要设置（真机联调时才跑，本地/CI 没有这些容器时自动跳过）：
 *   MDM_CUSTOMER_GRPC_ENDPOINT=http://<容器IP>:9090
 *   MDM_PRODUCT_GRPC_ENDPOINT=http://<容器IP>:9092
 *   TEST_CUSTOMER_ID=<提前用 grpcurl Create 出来的真实客户 id>
 *   TEST_PRODUCT_ID=<提前用 grpcurl Create 出来的真实产品 id>
 */

import { describe, expect, it } from "vitest";

const CUSTOMER_ID = process.env.TEST_CUSTOMER_ID ?? "";
const PRODUCT_ID = process.env.TEST_PRODUCT_ID ?? "";
const HAS_FIXTURES = Boolean(
  process.env.MDM_CUSTOMER_GRPC_ENDPOINT && process.env.MDM_PRODUCT_GRPC_ENDPOINT && CUSTOMER_ID && PRODUCT_ID,
);

describe.skipIf(!HAS_FIXTURES)("batchGetCustomers/batchGetProducts（真机）", () => {
  it("真实调 mdm-customer，拿到真实客户；缺失 id 按顺序补 undefined", async () => {
    const { batchGetCustomers } = await import("../src/clients/customer.js");
    // mdm-customer 的 id 是 bigint（BIGSERIAL），"missing" 也必须是数字
    // 形状——非数字字符串会在 SQL 层直接报 invalid input syntax，不是
    // 干净的"查不到"，这条真机测试跑出来才发现（不是看 schema 猜的）。
    const result = await batchGetCustomers("", [CUSTOMER_ID, "999999999"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(CUSTOMER_ID);
    expect(result[0]?.status).toBe("ACTIVE"); // 枚举前缀已剥掉，不是 CUSTOMER_STATUS_ACTIVE
    expect(result[1]).toBeUndefined();
  });

  it("真实调 mdm-product，拿到真实产品；枚举前缀已剥掉", async () => {
    const { batchGetProducts } = await import("../src/clients/product.js");
    const result = await batchGetProducts("", [PRODUCT_ID]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(PRODUCT_ID);
    expect(result[0]?.status).toBe("ACTIVE");
    expect(result[0]?.trackingType).toBe("NONE");
  });
});

describe("batchGetCustomers/batchGetProducts（不需要真机）", () => {
  it("空 ids 短路，不发请求", async () => {
    const { batchGetCustomers } = await import("../src/clients/customer.js");
    expect(await batchGetCustomers("", [])).toEqual([]);
    const { batchGetProducts } = await import("../src/clients/product.js");
    expect(await batchGetProducts("", [])).toEqual([]);
  });
});
