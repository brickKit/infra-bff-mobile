/**
 * mdm-product：`data_scopes: none`。按 id 取经 per-request DataLoader 合并成一次
 * gRPC BatchGet；关键字搜索直接调 gRPC List。
 */

import { requirePermission } from "besdk";
import { searchProducts } from "../clients/product.js";
import type { AppContext } from "../context.js";
import { assertBatchIdsWithinLimit } from "../limits.js";

interface SearchArgs {
  keyword: string;
  cursor?: string;
  pageSize?: number;
}

export const productResolvers = {
  product: requirePermission(
    "infra.bff-mobile.product.view",
    async (_source: unknown, args: { id: string }, context: AppContext) => {
      const found = await context.productLoader.load(args.id);
      return found ?? null;
    },
  ),
  products: requirePermission(
    "infra.bff-mobile.product.view",
    async (_source: unknown, args: { ids: string[] }, context: AppContext) => {
      assertBatchIdsWithinLimit("products", args.ids);
      return context.productLoader.loadMany(args.ids);
    },
  ),
  searchProducts: requirePermission(
    "infra.bff-mobile.product.view",
    async (_source: unknown, args: SearchArgs, context: AppContext) =>
      searchProducts(context, { q: args.keyword, cursor: args.cursor, pageSize: args.pageSize }),
  ),
};
