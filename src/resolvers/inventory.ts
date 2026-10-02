/**
 * erp-inventory：走 REST 转发，不走 gRPC——仓库维的数据权限（`mode: in`）只在
 * 对方 REST 面生效。
 */

import { requirePermission } from "besdk";
import { forwardGet } from "../clients/restForward.js";
import { DEP_ERP_INVENTORY } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawBalance {
  product_id: string;
  warehouse_id: string;
  on_hand_qty: string;
  reserved_qty: string;
  available_qty: string;
  version: number;
}

function balanceToDTO(raw: RawBalance) {
  return {
    productId: raw.product_id,
    warehouseId: raw.warehouse_id,
    onHandQty: raw.on_hand_qty,
    reservedQty: raw.reserved_qty,
    availableQty: raw.available_qty,
    version: raw.version,
  };
}

async function getBalance(args: { productId: string; warehouseId: string }, context: AppContext) {
  const params = new URLSearchParams({ product_id: args.productId, warehouse_id: args.warehouseId });
  const raw = (await forwardGet(context, DEP_ERP_INVENTORY, `/erp/inventory/balances?${params}`)) as RawBalance | null;
  return raw ? balanceToDTO(raw) : null;
}

export const inventoryResolvers = {
  inventoryBalance: requirePermission(
    "infra.bff-mobile.inventory.view",
    async (_source: unknown, args: { productId: string; warehouseId: string }, context: AppContext) =>
      getBalance(args, context),
  ),
};
