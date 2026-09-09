/**
 * createModule——唯一的装配入口，签名对应 be-sdk-go/be-sdk-python 的
 * `New`/`create_module`（总纲 §12.5.1）。不进任何外壳（§13.5），但入口
 * 契约仍然照抄——`runStandalone` 认的是这个签名，合并部署形态在这个
 * 组件上用不上，不代表接口可以另起一套。
 */

import type { Runtime, Module } from "besdk";
import { newGraphQLServer } from "besdk";
import { buildSchema } from "./schema.js";
import { resolveAvailableDependencies } from "./dependencies.js";
import { resolvers } from "./resolvers/index.js";
import { buildContext } from "./context.js";
import { getPersistedOperation } from "./persistedOperations.js";

export async function createModule(rt: Runtime): Promise<Module> {
  const available = resolveAvailableDependencies();
  const schema = buildSchema({ available, resolvers });

  const httpHandler = newGraphQLServer(rt, {
    schema,
    context: buildContext,
    getPersistedOperation,
  });

  // ⚠️ 类型断言，不是绕过类型安全：`besdk.Module.httpHandler` 故意把
  // 类型参数写死成 `Record<string, unknown>`（横切层不可能预先知道每个
  // 组件的 context 具体形状），而 Yoga 的 `Plugin<TContext>` 在
  // `TContext` 上是逆变的——`YogaServerInstance<..., AppContext>` 因此
  // 结构上不能直接赋给 `YogaServerInstance<..., Record<string,
  // unknown>>`，即使运行时行为完全一样（`runStandalone` 只是把
  // `httpHandler` 原样交给 `http.createServer`，从不检查它的类型参数）。
  return { httpHandler: httpHandler as unknown as Module["httpHandler"] };
}
