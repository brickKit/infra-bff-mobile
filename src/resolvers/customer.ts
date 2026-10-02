/**
 * mdm-customer：`data_scopes: none`，经 per-request DataLoader 合并成一次 gRPC BatchGet。
 */

import { requirePermission } from "besdk";
import type { AppContext } from "../context.js";

export const customerResolvers = {
  customer: requirePermission(
    "infra.bff-mobile.customer.view",
    async (_source: unknown, args: { id: string }, context: AppContext) => {
      const found = await context.customerLoader.load(args.id);
      return found ?? null;
    },
  ),
  customers: requirePermission(
    "infra.bff-mobile.customer.view",
    async (_source: unknown, args: { ids: string[] }, context: AppContext) =>
      context.customerLoader.loadMany(args.ids),
  ),
};
