/**
 * infra-workflow：走 REST 转发，不走 gRPC——owner / org 两维数据权限只在对方
 * REST 面生效。同意 / 驳回是纯转发：客户端给了幂等键就原样放进 body 的
 * `idempotency_key`，没给就不带这个字段（workflow 按待办状态去重，不靠它）；
 * 本组件不生成、不改写，也不在这里编排别的下游。
 */

import { requirePermission } from "besdk";
import { forwardGet, forwardPost, segment } from "../clients/restForward.js";
import { DEP_INFRA_WORKFLOW } from "../dependencies.js";
import type { AppContext } from "../context.js";

interface RawTask {
  id: string;
  type: string;
  status: string;
  assignee_sub: string;
  assignee_dept_path: string;
  title: string;
  summary: unknown; // REST 面已解析成 JSON 对象（gRPC 面是原始字符串 summary_json）
  source_component: string;
  source_aggregate: string;
  source_id: string;
  deep_link: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  /** 只有详情（GET /tasks/{id}、approve / reject 的响应）带审批历史 */
  actions?: RawTaskAction[];
}

interface RawTaskAction {
  actor_sub: string;
  action: string;
  comment: string;
  created_at: string;
}

interface TaskListResponse {
  tasks: RawTask[];
  next_cursor: string;
}

function taskToDTO(raw: RawTask) {
  return {
    id: raw.id,
    type: raw.type,
    status: raw.status,
    assigneeSub: raw.assignee_sub,
    assigneeDeptPath: raw.assignee_dept_path,
    title: raw.title,
    // 原样变回字符串：本组件不理解 summary 的业务含义，schema 约定它是 JSON
    // 字符串、前端自己解析（与 gRPC 面 summary_json 的语义一致）。
    summaryJson: JSON.stringify(raw.summary ?? {}),
    sourceComponent: raw.source_component,
    sourceAggregate: raw.source_aggregate,
    sourceId: raw.source_id,
    deepLink: raw.deep_link,
    dueAt: raw.due_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    actions: raw.actions ? raw.actions.map(actionToDTO) : null,
  };
}

function actionToDTO(raw: RawTaskAction) {
  return { actorSub: raw.actor_sub, action: raw.action, comment: raw.comment, createdAt: raw.created_at };
}

interface MyTasksArgs {
  cursor?: string;
  pageSize?: number;
  type?: string;
  status?: string;
}

async function listMyTasks(args: MyTasksArgs, context: AppContext) {
  const params = new URLSearchParams();
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.pageSize) params.set("page_size", String(args.pageSize));
  if (args.type) params.set("type", args.type);
  if (args.status) params.set("status", args.status);
  const query = params.toString();
  const path = `/infra/workflow/tasks${query ? `?${query}` : ""}`;
  const res = (await forwardGet(context, DEP_INFRA_WORKFLOW, path)) as TaskListResponse;
  return { tasks: res.tasks.map(taskToDTO), nextCursor: res.next_cursor };
}

async function getTask(id: string, context: AppContext) {
  const raw = (await forwardGet(context, DEP_INFRA_WORKFLOW, `/infra/workflow/tasks/${segment(id)}`)) as RawTask | null;
  return raw ? taskToDTO(raw) : null;
}

interface ActArgs {
  id: string;
  comment?: string | null;
  idempotencyKey?: string | null;
}

async function actOnTask(action: "approve" | "reject", args: ActArgs, context: AppContext) {
  const body: Record<string, string> = {};
  // 空串与没给同样处理：不发一个空的 idempotency_key
  if (args.idempotencyKey) body.idempotency_key = args.idempotencyKey;
  if (args.comment != null) body.comment = args.comment;
  const path = `/infra/workflow/tasks/${segment(args.id)}/${action}`;
  return taskToDTO((await forwardPost(context, DEP_INFRA_WORKFLOW, path, body)) as RawTask);
}

export const taskResolvers = {
  myTasks: requirePermission(
    "infra.bff-mobile.task.view",
    async (_source: unknown, args: MyTasksArgs, context: AppContext) => listMyTasks(args, context),
  ),
  task: requirePermission(
    "infra.bff-mobile.task.view",
    async (_source: unknown, args: { id: string }, context: AppContext) => getTask(args.id, context),
  ),
};

export const taskMutations = {
  approveTask: requirePermission(
    "infra.bff-mobile.task.act",
    async (_source: unknown, args: ActArgs, context: AppContext) => actOnTask("approve", args, context),
  ),
  rejectTask: requirePermission(
    "infra.bff-mobile.task.act",
    async (_source: unknown, args: ActArgs, context: AppContext) => actOnTask("reject", args, context),
  ),
};
