/**
 * erp-inventory——走 REST 转发（`GET /erp/inventory/balances`），不走
 * gRPC：warehouse 维数据权限（mode: in）只在 REST 面生效（同
 * task.ts/order.ts 的既有判据）。⚠️ 没有批量端点，`inventoryBalance`
 * 因此不提供 DataLoader 批量版本，见 contracts/schema.graphql 顶部
 * 注释。
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

function toDTO(raw: RawBalance) {
  return {
    productId: raw.product_id,
    warehouseId: raw.warehouse_id,
    onHandQty: raw.on_hand_qty,
    reservedQty: raw.reserved_qty,
    availableQty: raw.available_qty,
    version: raw.version,
  };
}

export const inventoryResolvers = {
  inventoryBalance: requirePermission(
    "infra.bff-mobile.inventory.view",
    async (
      _source: unknown,
      args: { productId: string; warehouseId: string },
      context: AppContext,
    ) => {
      const params = new URLSearchParams({
        product_id: args.productId,
        warehouse_id: args.warehouseId,
      });
      const raw = (await forwardGet(
        DEP_ERP_INVENTORY,
        context.auth,
        `/erp/inventory/balances?${params.toString()}`,
      )) as RawBalance | null;
      return raw ? toDTO(raw) : null;
    },
  ),
};
