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

import type { Config } from "besdk";
import type { DependencyId } from "../dependencies.js";

/** 一次转发需要的调用者信息：地址从 config 读，身份原样透传。 */
export interface Caller {
  config: Config;
  auth: string;
}

export class RestForwardError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
    throw new RestForwardError(resp.status, `${dep} ${path} 返回 ${resp.status}`);
  }
  return resp.json();
}
