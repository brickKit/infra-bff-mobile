/**
 * 每次请求的 GraphQL context——DataLoader 必须在这里现造，不能是模块级
 * 单例（设计计划 §7 的⚠️：单例会跨请求缓存命中，A 用户看到 B 用户的
 * 数据，且单请求测试永远测不出来）。
 */

import DataLoader from "dataloader";
import { createBatchGetLoader } from "besdk";
import { batchGetCustomers, type CustomerDTO } from "./clients/customer.js";
import { batchGetProducts, type ProductDTO } from "./clients/product.js";

export interface AppContext {
  // 索引签名：newGraphQLServer<TContext extends Record<string, unknown>>
  // 的约束要求——besdk 的 GraphQLServerOptions 是跨组件共用的横切层，
  // 不可能预先知道每个组件的 context 具体长什么样，只能约束"至少是个
  // 字符串键的对象"。
  [key: string]: unknown;
  request: Request;
  auth: string;
  customerLoader: DataLoader<string, CustomerDTO | undefined>;
  productLoader: DataLoader<string, ProductDTO | undefined>;
}

/** 原样取 Authorization 头的完整值（含 "Bearer " 前缀）转发给下游——本组件自己不解析 token 内容，那是 requirePermission 的职责。 */
function rawAuthHeader(request: Request): string {
  return request.headers.get("authorization") ?? "";
}

export function buildContext({ request }: { request: Request }): AppContext {
  const auth = rawAuthHeader(request);
  return {
    request,
    auth,
    customerLoader: createBatchGetLoader((ids) => batchGetCustomers(auth, ids)),
    productLoader: createBatchGetLoader((ids) => batchGetProducts(auth, ids)),
  };
}
