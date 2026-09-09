/**
 * infra-workflow——走 REST 转发（`GET /infra/workflow/tasks`），不走
 * gRPC：owner/org 两维数据权限只在 REST 面生效（设计计划 §1 的
 * `data_scopes` 表；见 contracts/schema.graphql 顶部注释与 AGENTS.md）。
 */

import { requirePermission } from "besdk";
import { forwardGet } from "../clients/restForward.js";
import { DEP_INFRA_WORKFLOW } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawTask {
  id: string;
  type: string;
  status: string;
  assignee_sub: string;
  assignee_dept_path: string;
  title: string;
  summary: unknown; // REST 面已解析成 JSON 对象（gRPC 侧是原始字符串 summary_json）
  source_component: string;
  source_aggregate: string;
  source_id: string;
  deep_link: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskListResponse {
  tasks: RawTask[];
  next_cursor: string;
}

function toDTO(raw: RawTask) {
  return {
    id: raw.id,
    type: raw.type,
    status: raw.status,
    assigneeSub: raw.assignee_sub,
    assigneeDeptPath: raw.assignee_dept_path,
    title: raw.title,
    // 原样透传成字符串——本组件不理解 summary 的业务含义，只是把 REST
    // 面已解析的对象重新变回 GraphQL schema 约定的 JSON 字符串（同
    // gRPC 侧 summary_json 字段的既有语义，见上方类型注释）。
    summaryJson: JSON.stringify(raw.summary ?? {}),
    sourceComponent: raw.source_component,
    sourceAggregate: raw.source_aggregate,
    sourceId: raw.source_id,
    deepLink: raw.deep_link,
    dueAt: raw.due_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface MyTasksArgs {
  cursor?: string;
  pageSize?: number;
  type?: string;
  status?: string;
}

export const taskResolvers = {
  myTasks: requirePermission(
    "infra.bff-mobile.task.view",
    async (_source: unknown, args: MyTasksArgs, context: AppContext) => {
      const params = new URLSearchParams();
      if (args.cursor) params.set("cursor", args.cursor);
      if (args.pageSize) params.set("page_size", String(args.pageSize));
      if (args.type) params.set("type", args.type);
      if (args.status) params.set("status", args.status);
      const query = params.toString();
      const path = `/infra/workflow/tasks${query ? `?${query}` : ""}`;

      const res = (await forwardGet(DEP_INFRA_WORKFLOW, context.auth, path)) as TaskListResponse;
      return {
        tasks: res.tasks.map(toDTO),
        nextCursor: res.next_cursor,
      };
    },
  ),
};
