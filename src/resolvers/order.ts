/**
 * erp-sales——走 REST 转发（`GET /erp/sales/orders[/{id}]`），不走
 * gRPC：org/owner 两维数据权限只在 REST 面生效（同 task.ts 的既有
 * 判据）。
 */

import { requirePermission } from "besdk";
import { forwardGet } from "../clients/restForward.js";
import { DEP_ERP_SALES } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawOrderItem {
  product_id: string;
  product_sku: string;
  product_name: string;
  uom_id: string;
  qty: string;
  unit_price: string;
  discount: string;
  tax_rate: string;
  subtotal: string;
}

interface RawOrder {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string;
  status: string;
  items: RawOrderItem[];
  total_amount: string;
  dept_id: string;
  dept_path: string;
  owner_id: string;
  reservation_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface OrderListResponse {
  orders: RawOrder[];
  next_cursor: string;
}

function itemToDTO(raw: RawOrderItem) {
  return {
    productId: raw.product_id,
    productSku: raw.product_sku,
    productName: raw.product_name,
    uomId: raw.uom_id,
    qty: raw.qty,
    unitPrice: raw.unit_price,
    discount: raw.discount,
    taxRate: raw.tax_rate,
    subtotal: raw.subtotal,
  };
}

function toDTO(raw: RawOrder) {
  return {
    id: raw.id,
    orderNo: raw.order_no,
    customerId: raw.customer_id,
    customerName: raw.customer_name,
    status: raw.status,
    items: raw.items.map(itemToDTO),
    totalAmount: raw.total_amount,
    deptId: raw.dept_id,
    deptPath: raw.dept_path,
    ownerId: raw.owner_id,
    reservationId: raw.reservation_id,
    version: raw.version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export const orderResolvers = {
  order: requirePermission(
    "infra.bff-mobile.order.view",
    async (_source: unknown, args: { id: string }, context: AppContext) => {
      const raw = (await forwardGet(DEP_ERP_SALES, context.auth, `/erp/sales/orders/${args.id}`)) as RawOrder | null;
      return raw ? toDTO(raw) : null;
    },
  ),
  myOrders: requirePermission(
    "infra.bff-mobile.order.view",
    async (
      _source: unknown,
      args: { cursor?: string; pageSize?: number; statusFilter?: string },
      context: AppContext,
    ) => {
      const params = new URLSearchParams();
      if (args.cursor) params.set("cursor", args.cursor);
      if (args.pageSize) params.set("page_size", String(args.pageSize));
      if (args.statusFilter) params.set("status_filter", args.statusFilter);
      const query = params.toString();
      const path = `/erp/sales/orders${query ? `?${query}` : ""}`;

      const res = (await forwardGet(DEP_ERP_SALES, context.auth, path)) as OrderListResponse;
      return {
        orders: res.orders.map(toDTO),
        nextCursor: res.next_cursor,
      };
    },
  ),
};
