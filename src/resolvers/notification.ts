/**
 * infra-notification：我的通知历史。走 REST 转发——通知按收件人（owner）过滤，
 * 只在对方 REST 面生效。
 */

import { requirePermission } from "besdk";
import { forwardGet } from "../clients/restForward.js";
import { DEP_INFRA_NOTIFICATION } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawNotification {
  id: string;
  category: string;
  channel: string;
  title: string;
  body: string;
  status: string;
  source_component: string;
  source_aggregate: string;
  source_id: string;
  created_at: string;
  updated_at: string;
}

interface RecordListResponse {
  records: RawNotification[];
  next_cursor: string;
}

function notificationToDTO(raw: RawNotification) {
  return {
    id: raw.id,
    category: raw.category,
    channel: raw.channel,
    title: raw.title,
    body: raw.body,
    status: raw.status,
    sourceComponent: raw.source_component,
    sourceAggregate: raw.source_aggregate,
    sourceId: raw.source_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface PageArgs {
  cursor?: string;
  pageSize?: number;
}

async function listMyNotifications(args: PageArgs, context: AppContext) {
  const params = new URLSearchParams();
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.pageSize) params.set("page_size", String(args.pageSize));
  const query = params.toString();
  const path = `/infra/notification/notifications${query ? `?${query}` : ""}`;
  const res = (await forwardGet(context, DEP_INFRA_NOTIFICATION, path)) as RecordListResponse;
  return { notifications: res.records.map(notificationToDTO), nextCursor: res.next_cursor };
}

export const notificationResolvers = {
  myNotifications: requirePermission(
    "infra.bff-mobile.notification.view",
    async (_source: unknown, args: PageArgs, context: AppContext) => listMyNotifications(args, context),
  ),
};
