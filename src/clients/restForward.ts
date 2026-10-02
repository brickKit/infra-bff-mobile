/**
 * REST 转发：订单、库存、待办这些数据有真实的 org / owner / warehouse 数据权限，
 * 而组件之间的 gRPC 协议不按调用者过滤（过滤只在各组件 REST 面的
 * `besdk.ScopeOf` 里生效）。所以这些字段原样带上调用者的 Authorization 去打
 * 对方的 REST 端点，由下游判权限；走 gRPC 就绕开了数据权限——在 query 里
 * 传一个别人的 id 就能看到别人的数据。
 *
 * 这里用裸 `fetch`，不用 `userClient` / `systemClient`：那两个只给 gRPC 用。
 * `config.endpoint()` 剥掉了 scheme（gRPC 要裸 host:port），REST 要重新拼上
 * `http://`。
 */

import { GraphQLError } from "graphql";
import type { Config, Runtime } from "besdk";
import type { DependencyId } from "../dependencies.js";

/** 一次转发需要的调用者信息：地址从 config 读，身份原样透传，拒绝原因记进 logger。 */
export interface Caller {
  config: Config;
  auth: string;
  logger: Runtime["logger"];
}

/**
 * 调用者能据此行动的下游状态码 → GraphQL 错误码。这些以 GraphQLError 抛出，
 * Yoga 原样交给客户端（401 重新登录、409 刷新再试…）；不在表里的（5xx、连接
 * 失败）是本组件或下游的意外故障，抛普通 Error，Yoga 只给客户端一句通用错误，
 * 内部细节不外泄。
 */
const VISIBLE_STATUS: Record<number, string> = {
  400: "BAD_USER_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
};

export class RestForwardError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 把调用方给的 id 编码成一段路径。不编码时 `order(id: "7?view=all")` 会把
 * `?` 之后变成查询参数、`../` 会改写路径，调用者借此拼出契约之外的请求。
 */
export function segment(id: string): string {
  return encodeURIComponent(id);
}

function baseUrl(caller: Caller, dep: DependencyId): string {
  const { value: host, ok } = caller.config.endpoint(dep);
  if (!ok) {
    throw new Error(`config.endpoint: 依赖 ${dep} 的地址未注入`);
  }
  return `http://${host}`;
}

/**
 * 打 `dep` 的 REST 面，原样带上调用者的 Authorization。`path` 以 `/` 开头且
 * 带上对方的路径前缀（如 `/infra/workflow/tasks?cursor=…`）。404 返回 `null`
 * （调用方按"查不到"处理），其余非 2xx 抛 `RestForwardError`。
 */
export async function forwardGet(caller: Caller, dep: DependencyId, path: string): Promise<unknown> {
  const resp = await fetch(`${baseUrl(caller, dep)}${path}`, {
    headers: caller.auth ? { authorization: caller.auth } : {},
  });
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    rejected(caller, dep, path, resp.status);
  }
  return resp.json();
}

/** 下游拒绝：先记日志（哪个依赖、哪个路径、什么状态码），再按 VISIBLE_STATUS 决定客户端看到什么。 */
function rejected(caller: Caller, dep: DependencyId, path: string, status: number): never {
  const message = `${dep} ${path} 返回 ${status}`;
  caller.logger.warn({ dep, path, status }, message);
  const code = VISIBLE_STATUS[status];
  if (code) {
    throw new GraphQLError(`${dep} 拒绝了这次请求（${status}）`, {
      extensions: { code, downstreamStatus: status },
    });
  }
  throw new RestForwardError(status, message);
}
