/**
 * infra-workflow 的待办详情与同意 / 驳回：REST 转发，Authorization 原样带上，
 * 写操作把客户端给的幂等键原样带给下游（本组件不生成、不改写幂等键）；幂等键
 * 是可选的：没给就不往 body 里放这个字段（workflow 按待办状态去重，不靠它）。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startBff, startHttpStub, type BffProcess, type HttpStub } from "./harness.js";

const TASK = `query Task($id: ID!) { task(id: $id) { id status title actions { actorSub action comment createdAt } } }`;
const APPROVE = `mutation Approve($id: ID!, $comment: String, $key: String!) {
  approveTask(id: $id, comment: $comment, idempotencyKey: $key) { id status actions { action comment } }
}`;
const REJECT = `mutation Reject($id: ID!, $comment: String!, $key: String!) {
  rejectTask(id: $id, comment: $comment, idempotencyKey: $key) { id status }
}`;
// 不带幂等键的写法：契约里 idempotencyKey 是可选参数
const APPROVE_NO_KEY = `mutation ApproveNoKey($id: ID!) { approveTask(id: $id) { id status } }`;
const REJECT_NO_KEY = `mutation RejectNoKey($id: ID!, $comment: String!) { rejectTask(id: $id, comment: $comment) { id status } }`;

function rawTask(id: string, status: string, actions: unknown[]) {
  return {
    id, type: "APPROVAL", status, assignee_sub: "u1", assignee_dept_path: "/d", title: `待办 ${id}`,
    summary: { amount: "10.00" }, source_component: "erp/sales", source_aggregate: "order", source_id: "o1",
    deep_link: "/orders/o1", due_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
    actions,
  };
}

let workflow: HttpStub;
let bff: BffProcess;

beforeAll(async () => {
  workflow = await startHttpStub((req) => {
    if (req.method === "GET" && req.url === "/infra/workflow/tasks/42") {
      return { status: 200, body: rawTask("42", "PENDING", []) };
    }
    if (req.method === "POST" && req.url === "/infra/workflow/tasks/42/approve") {
      return {
        status: 200,
        body: rawTask("42", "APPROVED", [
          { actor_sub: "u1", action: "APPROVED", comment: "同意", created_at: "2026-01-03T00:00:00Z" },
        ]),
      };
    }
    if (req.method === "POST" && req.url === "/infra/workflow/tasks/42/reject") {
      return { status: 200, body: rawTask("42", "REJECTED", []) };
    }
    if (req.method === "POST" && req.url === "/infra/workflow/tasks/43/approve") {
      return { status: 409, body: { error: "待办已经不是 PENDING 状态" } };
    }
    return { status: 404, body: { error: "not found" } };
  });
  bff = await startBff({
    endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
    queries: [TASK, APPROVE, REJECT, APPROVE_NO_KEY, REJECT_NO_KEY],
    roles: {
      viewer: ["infra.bff-mobile.task.view"],
      actor: ["infra.bff-mobile.task.view", "infra.bff-mobile.task.act"],
    },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await workflow?.close();
});

const lastRequest = () => workflow.requests.at(-1)!;

describe("task(id)", () => {
  it("转发 GET /infra/workflow/tasks/{id}，带上调用者的 Authorization，审批历史映射进 actions", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(TASK, { token, variables: { id: "42" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(lastRequest().headers.authorization).toBe(`Bearer ${token}`);
    expect(res.body.data?.task).toEqual({ id: "42", status: "PENDING", title: "待办 42", actions: [] });
  });

  it("下游 404：返回 null，不是错误", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(TASK, { token, variables: { id: "999" } });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data?.task).toBeNull();
  });

  it("不带 token：HTTP 401，下游收不到请求", async () => {
    const before = workflow.requests.length;
    const res = await bff.run(TASK, { variables: { id: "42" } });
    expect(res.status).toBe(401);
    expect(workflow.requests.length).toBe(before);
  });
});

describe("approveTask / rejectTask", () => {
  it("approveTask 转发 POST …/approve，body 带附言与客户端给的幂等键，返回处理后的详情", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(APPROVE, { token, variables: { id: "42", comment: "同意", key: "k-approve-1" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    const req = lastRequest();
    expect(req.method).toBe("POST");
    expect(req.url).toBe("/infra/workflow/tasks/42/approve");
    expect(req.headers.authorization).toBe(`Bearer ${token}`);
    expect(req.headers["content-type"]).toContain("application/json");
    expect(req.body).toEqual({ comment: "同意", idempotency_key: "k-approve-1" });
    expect(res.body.data?.approveTask).toEqual({
      id: "42",
      status: "APPROVED",
      actions: [{ action: "APPROVED", comment: "同意" }],
    });
  });

  it("同一个幂等键重试：两次转发带的是同一个键，本组件不生成也不改写", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    await bff.run(APPROVE, { token, variables: { id: "42", key: "k-retry" } });
    const first = lastRequest().body;
    await bff.run(APPROVE, { token, variables: { id: "42", key: "k-retry" } });
    expect(first).toEqual({ idempotency_key: "k-retry" });
    expect(lastRequest().body).toEqual(first);
  });

  it("rejectTask 转发 POST …/reject，body 带附言与幂等键", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(REJECT, { token, variables: { id: "42", comment: "金额不对", key: "k-reject-1" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(lastRequest().url).toBe("/infra/workflow/tasks/42/reject");
    expect(lastRequest().body).toEqual({ comment: "金额不对", idempotency_key: "k-reject-1" });
    expect(res.body.data?.rejectTask).toEqual({ id: "42", status: "REJECTED" });
  });

  it("下游 409（已不是 PENDING）：字段错误带 CONFLICT", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(APPROVE, { token, variables: { id: "43", key: "k-409" } });
    expect(res.body.errors?.[0]?.path).toEqual(["approveTask"]);
    expect(res.body.errors?.[0]?.extensions?.code).toBe("CONFLICT");
  });

  it("下游 404（待办不存在）：写操作是 NOT_FOUND 错误，不是 null", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(APPROVE, { token, variables: { id: "999", key: "k-404" } });
    expect(res.body.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
  });

  it("只有 task.view 没有 task.act：HTTP 403，下游收不到写请求", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const before = workflow.requests.length;
    const res = await bff.run(APPROVE, { token, variables: { id: "42", key: "k-403" } });
    expect(res.status).toBe(403);
    expect(workflow.requests.length).toBe(before);
  });

  it("不带 token：HTTP 401", async () => {
    const res = await bff.run(REJECT, { variables: { id: "42", comment: "x", key: "k-401" } });
    expect(res.status).toBe(401);
  });

  it("不给幂等键：approveTask 照常转发，body 里没有 idempotency_key 字段（不发空串）", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(APPROVE_NO_KEY, { token, variables: { id: "42" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(lastRequest().url).toBe("/infra/workflow/tasks/42/approve");
    expect(lastRequest().body).toEqual({});
    expect(res.body.data?.approveTask).toEqual({ id: "42", status: "APPROVED" });
  });

  it("不给幂等键：rejectTask 照常转发，body 只有附言", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["actor"] });
    const res = await bff.run(REJECT_NO_KEY, { token, variables: { id: "42", comment: "金额不对" } });
    expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
    expect(lastRequest().url).toBe("/infra/workflow/tasks/42/reject");
    expect(lastRequest().body).toEqual({ comment: "金额不对" });
    expect(res.body.data?.rejectTask).toEqual({ id: "42", status: "REJECTED" });
  });
});
