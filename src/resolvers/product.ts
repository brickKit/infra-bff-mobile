import { requirePermission } from "besdk";
import type { AppContext } from "../context.js";

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
    async (_source: unknown, args: { ids: string[] }, context: AppContext) =>
      context.productLoader.loadMany(args.ids),
  ),
};
