/**
 * 移动端边界上的数量上限。
 *
 * `customers(ids:)` / `products(ids:)` 的 id 经 DataLoader 合并成一次 gRPC
 * BatchGet，而 mdm-customer / mdm-product 的 BatchGet 本身不限个数；armor 的成本
 * 限制也不按列表参数的长度计。不设上限，登录用户一个请求带上万个 id，就扇出成
 * 一次同样大的下游查询。100 远大于移动端一屏要的行数（列表本身按游标分页）。
 *
 * 超限报在字段上（BAD_USER_INPUT），而不是做成 GraphQL 校验规则：前端发的是
 * 持久化查询，id 列表都在变量里，校验阶段还看不到变量的值。
 */

import { GraphQLError } from "graphql";

/** `customers(ids:)` / `products(ids:)` 一次最多带多少个 id；schema 的字段说明写着同一个数。 */
export const MAX_BATCH_IDS = 100;

/** 超过 MAX_BATCH_IDS 时抛 BAD_USER_INPUT，不调下游。在权限检查之后调。 */
export function assertBatchIdsWithinLimit(field: string, ids: readonly string[]): void {
  if (ids.length > MAX_BATCH_IDS) {
    throw new GraphQLError(`${field} 一次最多 ${MAX_BATCH_IDS} 个 id，收到 ${ids.length} 个`, {
      extensions: { code: "BAD_USER_INPUT", maxIds: MAX_BATCH_IDS },
    });
  }
}
