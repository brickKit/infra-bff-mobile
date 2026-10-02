/**
 * mdm-customer / mdm-product 的 gRPC 客户端，对真实容器、真实数据跑，不 mock。
 *
 * 地址变量是 gRPC 端口的 `MDM_CUSTOMER_GRPC_ENDPOINT` / `MDM_PRODUCT_GRPC_ENDPOINT`，
 * 不是主端口的 `MDM_CUSTOMER_ENDPOINT`：客户端传 extra "grpc" 读的就是前者。
 * 把 gRPC 地址塞进主端口变量能让漏传 "grpc" 的客户端碰巧连通，两个错误互相
 * 抵消，所以这里只用平台真实会注入的变量名。
 *
 * 需要设置（真机联调时才跑，没有这些容器时自动跳过）：
 *   MDM_CUSTOMER_GRPC_ENDPOINT=http://<容器IP>:9090
 *   MDM_PRODUCT_GRPC_ENDPOINT=http://<容器IP>:9092
 *   TEST_CUSTOMER_ID=<提前 Create 出来的真实客户 id>
 *   TEST_PRODUCT_ID=<提前 Create 出来的真实产品 id>
 */

import { describe, expect, it } from "vitest";
import { Config } from "besdk";
import type { Caller } from "../src/clients/restForward.js";

// 地址只从 Config 读：真机用例把本进程环境拍成一份 Config，同 runStandalone 的做法。
const config = new Config(
  Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
);
// 拒绝时客户端会记 warn；这里只验成功路径，日志写到 console 即可。
const caller: Caller = { config, auth: "", logger: console as unknown as Caller["logger"] };

const CUSTOMER_ID = process.env.TEST_CUSTOMER_ID ?? "";
const PRODUCT_ID = process.env.TEST_PRODUCT_ID ?? "";
const HAS_FIXTURES = Boolean(
  process.env.MDM_CUSTOMER_GRPC_ENDPOINT && process.env.MDM_PRODUCT_GRPC_ENDPOINT && CUSTOMER_ID && PRODUCT_ID,
);

describe.skipIf(!HAS_FIXTURES)("batchGetCustomers/batchGetProducts（真机）", () => {
  it("真实调 mdm-customer，拿到真实客户；缺失 id 按顺序补 undefined", async () => {
    const { batchGetCustomers } = await import("../src/clients/customer.js");
    // mdm-customer 的 id 是 bigint，"查不到"的 id 也必须是数字形状：非数字
    // 字符串在 SQL 层直接报 invalid input syntax，不是干净的"查不到"。
    const result = await batchGetCustomers(caller, [CUSTOMER_ID, "999999999"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(CUSTOMER_ID);
    expect(result[0]?.status).toBe("ACTIVE"); // 枚举前缀已剥掉，不是 CUSTOMER_STATUS_ACTIVE
    expect(result[1]).toBeUndefined();
  });

  it("真实调 mdm-product，拿到真实产品；枚举前缀已剥掉", async () => {
    const { batchGetProducts } = await import("../src/clients/product.js");
    const result = await batchGetProducts(caller, [PRODUCT_ID]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(PRODUCT_ID);
    expect(result[0]?.status).toBe("ACTIVE");
    expect(result[0]?.trackingType).toBe("NONE");
  });
});

describe("batchGetCustomers/batchGetProducts（不需要真机）", () => {
  it("空 ids 短路，不发请求", async () => {
    const { batchGetCustomers } = await import("../src/clients/customer.js");
    expect(await batchGetCustomers(caller, [])).toEqual([]);
    const { batchGetProducts } = await import("../src/clients/product.js");
    expect(await batchGetProducts(caller, [])).toEqual([]);
  });
});
