/**
 * 持久化查询清单的来源：默认是镜像里的 `contracts/persisted-operations.json`
 * （仓库里是空对象，拒绝一切）；配置键 `PERSISTED_OPERATIONS_JSON` 非空时，它的
 * 值就是整份清单（部署时用 `file://` 给），整份替换文件里的清单，不合并。
 * 不论来源，都只认清单里的查询：这个键换的是清单，不是关掉限制。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorLogLines, sha256, startBff, startHttpStub, type BffProcess, type HttpStub } from "./harness.js";

const TASK = `query Task($id: ID!) { task(id: $id) { id status } }`;
const TASK_OTHER = `query TaskOther($id: ID!) { task(id: $id) { id title } }`;
const ROLES = { viewer: ["infra.bff-mobile.task.view"] };

function rawTask(id: string) {
  return {
    id, type: "APPROVAL", status: "PENDING", assignee_sub: "u1", assignee_dept_path: "/d", title: `待办 ${id}`,
    summary: {}, source_component: "erp/sales", source_aggregate: "order", source_id: "o1",
    deep_link: "/orders/o1", due_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
  };
}

let workflow: HttpStub;

beforeAll(async () => {
  workflow = await startHttpStub(() => ({ status: 200, body: rawTask("42") }));
});

afterAll(async () => {
  await workflow?.close();
});

describe("PERSISTED_OPERATIONS_JSON", () => {
  it("非空时它就是清单：文件里的清单为空，配置里的查询照样能执行", async () => {
    const bff = await startBff({
      endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
      queries: [],
      roles: ROLES,
      manifestConfig: JSON.stringify({ [sha256(TASK)]: TASK }),
    });
    try {
      const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
      const res = await bff.run(TASK, { token, variables: { id: "42" } });
      expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
      expect(res.body.data?.task).toEqual({ id: "42", status: "PENDING" });
    } finally {
      await bff.close();
    }
  }, 30_000);

  it("整份替换文件里的清单：只在文件里的查询被拒绝，不是两份合并", async () => {
    const bff = await startBff({
      endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
      queries: [TASK_OTHER],
      roles: ROLES,
      manifestConfig: JSON.stringify({ [sha256(TASK)]: TASK }),
    });
    try {
      const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
      const res = await bff.run(TASK_OTHER, { token, variables: { id: "42" } });
      expect(res.body.data ?? null).toBeNull();
      expect(res.body.errors?.[0]?.message).toMatch(/PersistedQueryNotFound/);
    } finally {
      await bff.close();
    }
  }, 30_000);

  it("空串等于没配：用文件里的清单", async () => {
    const bff = await startBff({
      endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
      queries: [TASK],
      roles: ROLES,
      manifestConfig: "",
    });
    try {
      const token = await bff.jwks.sign({ sub: "u1", roles: ["viewer"] });
      const res = await bff.run(TASK, { token, variables: { id: "42" } });
      expect(res.body.errors, JSON.stringify(res.body)).toBeUndefined();
      expect(res.body.data?.task).toEqual({ id: "42", status: "PENDING" });
    } finally {
      await bff.close();
    }
  }, 30_000);

  it.each([
    ["不是 JSON", "{not json"],
    ["不是对象", JSON.stringify([TASK])],
    ["值不是字符串", JSON.stringify({ [sha256(TASK)]: 1 })],
  ])("%s：启动失败、日志点名这个键，而不是带着空清单悄悄起来", async (_name, value) => {
    await expect(
      startBff({
        endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
        queries: [TASK],
        roles: ROLES,
        manifestConfig: value,
      }),
    ).rejects.toThrow(/退出[\s\S]*PERSISTED_OPERATIONS_JSON/);
  }, 30_000);
});

// 客户端自己挑的哈希：清单是 JSON.parse 出来的普通对象，按下标查会摸到
// Object.prototype 上继承来的属性（`__proto__` 是一个对象、`constructor` 是一个
// 函数）。这条边界在登录之前，任何人都能发；它只能得到"查不到"，不能是 500
// 加一条带堆栈的 ERROR 日志，也不能是一句暴露实现细节的 400。
const INHERITED_KEYS = ["__proto__", "constructor", "toString", "hasOwnProperty"];

async function settledLogs(bff: BffProcess, since: number): Promise<string> {
  // 日志经管道异步到达，可能比响应晚；断言"没有 ERROR 行"之前等它落地
  await new Promise((r) => setTimeout(r, 300));
  return bff.logs().slice(since);
}

describe("持久化查询的边界（不带 token）", () => {
  let bff: BffProcess;

  beforeAll(async () => {
    bff = await startBff({
      endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
      queries: [TASK],
      roles: ROLES,
    });
  }, 30_000);

  afterAll(async () => {
    await bff?.close();
  });

  it.each(INHERITED_KEYS)("哈希 %s：PersistedQueryNotFound，HTTP 200，没有 ERROR 日志", async (hash) => {
    const before = bff.logs().length;
    const res = await bff.post({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } });
    expect(res.body.errors?.[0]?.message, JSON.stringify(res.body)).toMatch(/PersistedQueryNotFound/);
    expect(res.status).toBe(200);
    expect(errorLogLines(await settledLogs(bff, before))).toEqual([]);
  });

  it("GET 带继承属性名做哈希：同样是 PersistedQueryNotFound", async () => {
    const extensions = JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "constructor" } });
    const resp = await fetch(`${bff.graphqlUrl}?extensions=${encodeURIComponent(extensions)}`, {
      headers: { accept: "application/json" },
    });
    const body = (await resp.json()) as { errors?: Array<{ message: string }> };
    expect(body.errors?.[0]?.message, JSON.stringify(body)).toMatch(/PersistedQueryNotFound/);
  });

  it("带查询文本的请求：PersistedQueryOnly，不执行", async () => {
    const res = await bff.post({ query: "{ __typename }" });
    expect(res.body.data ?? null).toBeNull();
    expect(res.body.errors?.[0]?.message, JSON.stringify(res.body)).toMatch(/PersistedQueryOnly/);
  });

  it("查询文本加一个清单里有的哈希：仍然 PersistedQueryOnly", async () => {
    const res = await bff.post({
      query: "{ __typename }",
      extensions: { persistedQuery: { version: 1, sha256Hash: sha256(TASK) } },
    });
    expect(res.body.data ?? null).toBeNull();
    expect(res.body.errors?.[0]?.message, JSON.stringify(res.body)).toMatch(/PersistedQueryOnly/);
  });
});

describe("PERSISTED_OPERATIONS_JSON 换的是清单，不是关掉限制", () => {
  it("配了这个键：带查询文本的请求照样 PersistedQueryOnly；继承属性名照样查不到", async () => {
    const bff = await startBff({
      endpoints: { INFRA_WORKFLOW_ENDPOINT: workflow.url },
      queries: [],
      roles: ROLES,
      manifestConfig: JSON.stringify({ [sha256(TASK)]: TASK }),
    });
    try {
      const text = await bff.post({ query: "{ __typename }" });
      expect(text.body.data ?? null).toBeNull();
      expect(text.body.errors?.[0]?.message, JSON.stringify(text.body)).toMatch(/PersistedQueryOnly/);
      const before = bff.logs().length;
      const proto = await bff.post({ extensions: { persistedQuery: { version: 1, sha256Hash: "__proto__" } } });
      expect(proto.body.errors?.[0]?.message, JSON.stringify(proto.body)).toMatch(/PersistedQueryNotFound/);
      expect(errorLogLines(await settledLogs(bff, before))).toEqual([]);
    } finally {
      await bff.close();
    }
  }, 30_000);
});
