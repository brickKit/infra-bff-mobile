/**
 * 下游 REST 拒绝时客户端看到什么：401 / 403 / 404（写）/ 409 / 400 是调用者能处理
 * 的结果（重新登录、没权限、不存在、状态已变要刷新、请求写错），以
 * extensions.code 透给客户端；其余失败对客户端显示为通用错误。两种情况都在
 * 日志里写下"哪个依赖、哪个路径、什么状态码"。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logsAfter, startBff, startHttpStub, type BffProcess, type HttpStub } from "./harness.js";

const MY_TASKS = `query MyTasks($status: TaskStatus) { myTasks(status: $status) { nextCursor } }`;

// 按 status 参数决定桩的响应码，一个桩覆盖全部情形。
const STATUS_BY_FILTER: Record<string, number> = { PENDING: 401, APPROVED: 403, REJECTED: 500 };

let workflow: HttpStub;
let bff: BffProcess;

beforeAll(async () => {
  workflow = await startHttpStub((req) => {
    const filter = new URL(req.url, "http://x").searchParams.get("status") ?? "";
    return { status: STATUS_BY_FILTER[filter] ?? 200, body: { error: "下游内部细节" } };
  });
  bff = await startBff({
    endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
    queries: [MY_TASKS],
    roles: { viewer: ["infra.bff-mobile.task.view"] },
  });
}, 30_000);

afterAll(async () => {
  await bff?.close();
  await workflow?.close();
});

describe("下游拒绝的透传", () => {
  it("下游 401：字段错误带 UNAUTHENTICATED，日志写明依赖、路径与状态码", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(MY_TASKS, { token, variables: { status: "PENDING" } });
    expect(res.body.errors?.[0]?.path).toEqual(["myTasks"]);
    expect(res.body.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect(await logsAfter(bff, 0, "infra/workflow /infra/workflow/tasks?status=PENDING 返回 401")).toContain("infra/workflow /infra/workflow/tasks?status=PENDING 返回 401");
  });

  it("调用者能处理的拒绝（4xx）不记 ERROR：访问日志与指标已经记下状态码", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    await bff.run(MY_TASKS, { token, variables: { status: "PENDING" } });
    const lines = bff.logs().split("\n").filter((l) => l.includes("返回 401"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // SDK 的 logger 把级别写成标签（"info" / "warn" / "error"）
      expect(["debug", "info", "warn"]).toContain(JSON.parse(line).level);
    }
  });

  it("下游 403：字段错误带 FORBIDDEN", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(MY_TASKS, { token, variables: { status: "APPROVED" } });
    expect(res.body.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("下游 500：客户端只看到通用错误，看不到下游的内部细节；日志里有状态码", async () => {
    const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
    const res = await bff.run(MY_TASKS, { token, variables: { status: "REJECTED" } });
    expect(res.body.errors?.[0]?.message).toBe("Unexpected error.");
    expect(JSON.stringify(res.body)).not.toContain("下游内部细节");
    expect(await logsAfter(bff, 0, "infra/workflow /infra/workflow/tasks?status=REJECTED 返回 500")).toContain("infra/workflow /infra/workflow/tasks?status=REJECTED 返回 500");
  });
});
