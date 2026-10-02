/**
 * Persisted Operations 清单：构建期产物（哈希 → 查询文本），由前端构建时生成、
 * 随本组件镜像发布，所以前端与本组件的版本要配套发布。运行期只读：可写的
 * 注册表等于允许任何人注册任意查询，这层限制就白做了。
 *
 * 仓库里的清单是空对象，这是 fail-closed 的默认值，不是"关掉限制"：
 * 只认清单里的哈希，空清单就拒绝一切非 introspection 查询；前端产出清单后
 * 替换这个文件即可，不用改代码。
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

// 启动时读一次：清单是构建期产物，运行期不会变，不必每次请求重读。
const manifest = loadManifest();

export function getPersistedOperation(key: string): string | null {
  return manifest[key] ?? null;
}
