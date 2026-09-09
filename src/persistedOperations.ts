/**
 * Persisted Operations 清单——构建期产物，前端构建时生成、随本组件的
 * 镜像发布（设计计划 §3.4，§9 待决问题 3：两个仓库的版本要配套发布，
 * 留给部署手册记）。运行时**只读**，不是运行时可写的注册表——运行时
 * 可写就意味着有人能注册任意查询，等于没做这层限制（设计计划 §2）。
 *
 * ⚠️ 清单文件目前是空对象——还没有真实前端构建产出这份清单（`frontend-
 * standard` 是阶段三 Task 12，在本组件之后）。空清单不是"关掉这道
 * 限制"，而是这道限制天然的 fail-closed 默认值：`persisted_queries_
 * only: true` 意味着没在清单里的哈希一律拒绝，空清单 = 拒绝一切非
 * introspection 查询，等前端真的产出清单再替换这个文件，不需要改代码。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(process.cwd(), "contracts/persisted-operations.json");

function loadManifest(): Record<string, string> {
  if (!existsSync(MANIFEST_PATH)) {
    return {};
  }
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Record<string, string>;
}

// 启动时读一次——同 Persisted Operations 的既有心智模型：构建期产物，
// 不是运行时会变的东西，没必要每次请求都重新读文件。
const manifest = loadManifest();

export function getPersistedOperation(key: string): string | null {
  return manifest[key] ?? null;
}
