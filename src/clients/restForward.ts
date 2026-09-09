/**
 * REST 转发——erp-sales/erp-inventory/infra-workflow 的订单/库存/待办
 * 都有真实 org/owner/warehouse 数据权限，而全项目的 gRPC 组件间协议
 * 统一不做数据权限过滤（真正的过滤只在各自 REST 面的 besdk.ScopeOf
 * 生效）。这三类字段原样转发调用方的 Authorization 头去打对方的 REST
 * 端点，让下游去判，不走 `besdk` 的 `userClient`/`systemClient`（那两个
 * 是 gRPC 专用，这里要的是裸 HTTP）——这是阶段三 Task 11 的一次真实
 * 设计决策，用户在数据权限缺口被发现时明确拍的板（见 AGENTS.md）。
 *
 * ⚠️ `besdk.endpoint()` 剥掉了 scheme（gRPC 客户端要裸 host:port，导读
 * 第 1 条），这里反过来要重新拼上 `http://`——两个方向相反，同
 * `storageEndpoint()` 与 `endpoint()` 的既有分工（导读第 12 条），不能
 * 因为都是"拼 URL"就合并成一个函数。
 */

import { endpoint } from "besdk";
import type { DependencyId } from "../dependencies.js";

export class RestForwardError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 打 `dep` 的 REST 面，原样带上调用方的 Authorization。`path` 必须以
 * `/` 开头（如 `/tasks?cursor=...`）。404 时返回 `null`（调用方按
 * "查不到"处理，不当错误），其余非 2xx 抛 `RestForwardError`。
 */
export async function forwardGet(dep: DependencyId, auth: string, path: string): Promise<unknown> {
  const { value: host, ok } = endpoint(dep);
  if (!ok) {
    throw new Error(`besdk.endpoint: 依赖 ${dep} 的地址未注入`);
  }
  const resp = await fetch(`http://${host}${path}`, {
    headers: auth ? { authorization: auth } : {},
  });
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok) {
    throw new RestForwardError(resp.status, `${dep} ${path} 返回 ${resp.status}`);
  }
  return resp.json();
}
