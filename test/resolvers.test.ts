/**
 * 每个根字段（Query / Mutation）都经过 requirePermission：按行扫描的
 * module-check 看不见换行的参数列表，这里逐个真的调用一次。本进程从来没有
 * 装配鉴权（没跑 runStandalone），包过的 resolver 必定在碰下游之前就失败关闭
 * （403 "权限判定尚未配置"）；裸 resolver 会直接去调下游，抛的是别的错误或者
 * 干脆返回数据。
 */

import { describe, expect, it } from "vitest";
import { resolvers } from "../src/resolvers/index.js";
import { FIELD_TO_DEPENDENCY } from "../src/dependencies.js";

type Resolver = (source: unknown, args: unknown, context: unknown, info: unknown) => unknown;

const rootFields = (["Query", "Mutation"] as const).flatMap((type) =>
  Object.entries(resolvers[type] as Record<string, Resolver>).map(([name, fn]) => [`${type}.${name}`, fn] as const),
);

describe("根字段的权限包装", () => {
  it("每个在 dependencies.ts 登记过的字段都有 resolver（反过来也成立）", () => {
    const names = rootFields.map(([full]) => full.split(".")[1]).sort();
    expect(names).toEqual(Object.keys(FIELD_TO_DEPENDENCY).sort());
  });

  it.each(rootFields)("%s 没有鉴权装配时失败关闭（403），不碰下游", (_name, fn) => {
    let thrown: unknown;
    try {
      fn(undefined, {}, { request: new Request("http://bff.test/graphql") }, undefined);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { extensions?: { code?: string } })?.extensions?.code).toBe("FORBIDDEN");
  });
});
