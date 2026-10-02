/**
 * createModule：唯一的装配入口，与 be-sdk-go 的 `New`、be-sdk-python 的
 * `create_module` 对应，`runStandalone` 认的就是这个签名。本组件不进任何
 * 外壳（TypeScript 进程里没有别的成员可以合进来），但入口契约照样遵守：
 * 不自己 listen、不读 process.env、不做进程级初始化。
 */

import type { Runtime, Module } from "besdk";
import { newGraphQLServer } from "besdk";
import { buildSchema } from "./schema.js";
import { resolveAvailableDependencies } from "./dependencies.js";
import { resolvers } from "./resolvers/index.js";
import { contextFactory } from "./context.js";
import { loadPersistedOperations } from "./persistedOperations.js";

export async function createModule(rt: Runtime): Promise<Module> {
  const available = resolveAvailableDependencies(rt.config);
  const schema = buildSchema({ available, resolvers });

  const httpHandler = newGraphQLServer(rt, {
    schema,
    context: contextFactory(rt),
    getPersistedOperation: loadPersistedOperations(rt.config),
  });

  // 类型断言不是绕过类型安全：`Module.httpHandler` 把 context 类型写死成
  // `Record<string, unknown>`，而 Yoga 的 `Plugin<TContext>` 在 TContext 上是
  // 逆变的，`YogaServerInstance<…, AppContext>` 因此在结构上不能直接赋过去，
  // 运行时行为却完全一样（`runStandalone` 只把它交给 `http.createServer`）。
  return { httpHandler: httpHandler as unknown as Module["httpHandler"] };
}
