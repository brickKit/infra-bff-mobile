/**
 * 每次请求的 GraphQL context。DataLoader 必须在这里每次请求现造，不能是模块级
 * 单例：单例会跨请求命中缓存，A 用户看到 B 用户的数据，而且单请求测试永远
 * 测不出来。
 */

import DataLoader from "dataloader";
import { createBatchGetLoader, type Runtime } from "besdk";
import { batchGetCustomers, type CustomerDTO } from "./clients/customer.js";
import { batchGetProducts, type ProductDTO } from "./clients/product.js";
import type { Caller } from "./clients/restForward.js";

export interface AppContext extends Caller {
  // 索引签名是 newGraphQLServer<TContext extends Record<string, unknown>> 的
  // 约束：SDK 不可能预先知道每个组件的 context 长什么样。
  [key: string]: unknown;
  request: Request;
  customerLoader: DataLoader<string, CustomerDTO | undefined>;
  productLoader: DataLoader<string, ProductDTO | undefined>;
}

/** 原样取 Authorization 头的完整值（含 "Bearer " 前缀）转发给下游；token 的校验是 requirePermission 的事。 */
function rawAuthHeader(request: Request): string {
  return request.headers.get("authorization") ?? "";
}

export function contextFactory(rt: Pick<Runtime, "config" | "logger">): (init: { request: Request }) => AppContext {
  const { config, logger } = rt;
  return ({ request }) => {
    const caller: Caller = { config, auth: rawAuthHeader(request), logger };
    return {
      ...caller,
      request,
      customerLoader: createBatchGetLoader((ids) => batchGetCustomers(caller, ids)),
      productLoader: createBatchGetLoader((ids) => batchGetProducts(caller, ids)),
    };
  };
}
