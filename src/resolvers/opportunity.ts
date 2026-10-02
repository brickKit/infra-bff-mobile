/**
 * crm-opportunity：我的商机与商机详情。走 REST 转发——org / owner 两维数据权限
 * 只在对方 REST 面生效。列表固定 `view=mine`（只看我负责的），与移动端"商机
 * 速览"一致；看部门的商机是 PC 端的事。
 */

import { requirePermission } from "besdk";
import { forwardGet, segment } from "../clients/restForward.js";
import { DEP_CRM_OPPORTUNITY } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawOpportunityItem {
  product_id: string;
  product_sku: string;
  product_name: string;
  uom_id: string;
  qty: string;
  quoted_unit_price: string;
  subtotal: string;
}

interface RawOpportunity {
  id: string;
  name: string;
  customer_id: string;
  customer_name: string;
  owner_id: string;
  dept_id: string;
  dept_path: string;
  stage_id: string;
  stage_name: string;
  items: RawOpportunityItem[] | null;
  expected_amount: string;
  probability: number;
  weighted_amount: string;
  expected_close_date: string | null;
  status: string;
  currency: string;
  lost_reason: string;
  won_at: string | null;
  order_id?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface OpportunityListResponse {
  opportunities: RawOpportunity[];
  next_cursor: string;
}

function itemToDTO(raw: RawOpportunityItem) {
  return {
    productId: raw.product_id,
    productSku: raw.product_sku,
    productName: raw.product_name,
    uomId: raw.uom_id,
    qty: raw.qty,
    quotedUnitPrice: raw.quoted_unit_price,
    subtotal: raw.subtotal,
  };
}

function opportunityToDTO(raw: RawOpportunity) {
  return {
    id: raw.id,
    name: raw.name,
    customerId: raw.customer_id,
    customerName: raw.customer_name,
    ownerId: raw.owner_id,
    deptId: raw.dept_id,
    deptPath: raw.dept_path,
    stageId: raw.stage_id,
    stageName: raw.stage_name,
    items: (raw.items ?? []).map(itemToDTO),
    expectedAmount: raw.expected_amount,
    probability: raw.probability,
    weightedAmount: raw.weighted_amount,
    // 空串与缺省都当"没有"：Go 的零值时间不该以 0001-01-01 出现在移动端
    expectedCloseDate: raw.expected_close_date || null,
    status: raw.status,
    currency: raw.currency,
    lostReason: raw.lost_reason,
    wonAt: raw.won_at || null,
    orderId: raw.order_id ?? "",
    version: raw.version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface MyOpportunitiesArgs {
  cursor?: string;
  pageSize?: number;
  status?: string;
}

async function listMyOpportunities(args: MyOpportunitiesArgs, context: AppContext) {
  const params = new URLSearchParams({ view: "mine" });
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.pageSize) params.set("page_size", String(args.pageSize));
  if (args.status) params.set("status_filter", args.status);
  const path = `/crm/opportunity/opportunities?${params}`;
  const res = (await forwardGet(context, DEP_CRM_OPPORTUNITY, path)) as OpportunityListResponse;
  return { opportunities: res.opportunities.map(opportunityToDTO), nextCursor: res.next_cursor };
}

async function getOpportunity(id: string, context: AppContext) {
  const path = `/crm/opportunity/opportunities/${segment(id)}`;
  const raw = (await forwardGet(context, DEP_CRM_OPPORTUNITY, path)) as RawOpportunity | null;
  return raw ? opportunityToDTO(raw) : null;
}

export const opportunityResolvers = {
  myOpportunities: requirePermission(
    "infra.bff-mobile.opportunity.view",
    async (_source: unknown, args: MyOpportunitiesArgs, context: AppContext) => listMyOpportunities(args, context),
  ),
  opportunity: requirePermission(
    "infra.bff-mobile.opportunity.view",
    async (_source: unknown, args: { id: string }, context: AppContext) => getOpportunity(args.id, context),
  ),
};
