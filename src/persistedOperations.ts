/**
 * Persisted Operations 清单（哈希 → 查询文本）：只认清单里的查询，这层限制在
 * 任何部署里都开着。清单从哪来：
 *
 * - 配置键 `PERSISTED_OPERATIONS_JSON` 非空时，它的值就是整份清单（部署时一般写
 *   `file://<清单文件>`，平台把文件内容注入进来）。它整份替换镜像里的清单，不合并：
 *   两份合并的结果没有人审过。
 * - 否则用镜像里的 `contracts/persisted-operations.json`。仓库里它是空对象，这是
 *   fail-closed 的默认值，不是"关掉限制"：空清单拒绝一切非 introspection 查询。
 *
 * 清单是构建期产物（前端构建时生成），启动时读一次，运行期只读：可写的注册表
 * 等于允许任何人注册任意查询，这层限制就白做了。配置给了却不是"字符串到字符串
 * 的 JSON 对象"时启动失败：带着一份空清单悄悄起来，症状是所有页面都报
 * PersistedQueryNotFound，查不到原因。
 *
 * 清单读进来就转成 Map：哈希是客户端随便填的，登录之前就能发。按下标查一个
 * JSON.parse 出来的普通对象，`__proto__` / `constructor` / `toString` 会摸到
 * Object.prototype 上继承来的东西，Yoga 拿一个对象或函数当查询文本，回 500 并记
 * 一条带堆栈的 ERROR，或回一句暴露实现细节的 400。Map 只认清单里自己的键。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "besdk";

export const MANIFEST_CONFIG_KEY = "PERSISTED_OPERATIONS_JSON";

// 按工作目录找 contracts/：容器 WORKDIR 与本地运行时的工作目录都是仓库根
const BUILT_IN_MANIFEST = join(process.cwd(), "contracts/persisted-operations.json");

function parseManifest(raw: string, source: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`持久化查询清单（${source}）不是合法 JSON：${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`持久化查询清单（${source}）必须是 {哈希: 查询文本} 形式的 JSON 对象`);
  }
  const manifest = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`持久化查询清单（${source}）里 ${key} 的值不是字符串`);
    }
    manifest.set(key, value);
  }
  return manifest;
}

/** 读一次清单，返回给 Yoga 的查找函数。 */
export function loadPersistedOperations(config: Config): (key: string) => string | null {
  const configured = config.stringOr(MANIFEST_CONFIG_KEY, "");
  let manifest = new Map<string, string>();
  if (configured !== "") {
    manifest = parseManifest(configured, `配置键 ${MANIFEST_CONFIG_KEY}`);
  } else if (existsSync(BUILT_IN_MANIFEST)) {
    manifest = parseManifest(readFileSync(BUILT_IN_MANIFEST, "utf-8"), "contracts/persisted-operations.json");
  }
  return (key) => manifest.get(key) ?? null;
}
