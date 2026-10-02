/**
 * make contract-check 用：contracts/schema.graphql 能解析成一份合法 schema；给了
 * `--against <git 引用>` 时，再与那个版本的 schema.graphql 比，有破坏性变化
 * （删字段、改类型、新增必填参数…）就以 1 退出。契约只增不改，客户端按旧
 * schema 写的查询必须照样能跑。
 */

import { execFileSync } from "node:child_process";
import { buildASTSchema, findBreakingChanges, findDangerousChanges, parse } from "graphql";
import { loadFullSchemaDocument } from "../src/schema.js";

const current = buildASTSchema(loadFullSchemaDocument());
console.log("✓ contracts/schema.graphql 语法合法");

const at = process.argv.indexOf("--against");
const ref = at >= 0 ? process.argv[at + 1] : undefined;
if (at >= 0 && !ref) {
  console.error("✗ --against 后面要跟一个 git 引用（例如上一个发布 tag）");
  process.exit(2);
}
if (ref) {
  const oldText = execFileSync("git", ["show", `${ref}:contracts/schema.graphql`], { encoding: "utf-8" });
  const previous = buildASTSchema(parse(oldText));
  const breaking = findBreakingChanges(previous, current);
  for (const change of findDangerousChanges(previous, current)) {
    console.log(`ℹ️  需要留意（不算破坏）：${change.description}`);
  }
  if (breaking.length > 0) {
    console.error(`✗ 相对 ${ref} 有 ${breaking.length} 处破坏性变化：`);
    for (const change of breaking) {
      console.error(`  ${change.type}: ${change.description}`);
    }
    process.exit(1);
  }
  console.log(`✓ 相对 ${ref} 只增不改`);
}
