/**
 * 从 contracts/schema.graphql（唯一真相源，随组件分发的 api-contract
 * artifact）解析出完整 schema，再按这次装配实际有哪些弱依赖裁掉 Query
 * 里对应的字段（设计计划 §3.3）——不是"注册了返回 null"，是**根本不
 * 在 schema 里**，否则 introspection 会把字段暴露出去，前端按 schema
 * 写了查询、运行时永远拿 null（"页面空白但不报错"）。
 *
 * ⚠️ 只裁 Query 的字段，不做"顺带清理没人引用的类型定义"这种额外工作
 * ——GraphQL 允许 schema 里存在没有任何字段引用到的类型，不影响可查询
 * 的表面积（真正需要裁的只是 Query 字段这一层，设计计划 §3.3 原文点名
 * 的症状也只关于字段）。
 *
 * ⚠️ 读文件按 CWD 相对路径，不用 `__dirname`/`import.meta.url` 反推——
 * 同 infra-print 的既有教训（`app/module.py` 的注释）：CWD 由调用方
 * （容器 WORKDIR、本地开发时的仓库根目录）保证是仓库根，跟 build 产物
 * 落在哪个目录无关。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, Kind, type DocumentNode, type ObjectTypeDefinitionNode } from "graphql";
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { IResolvers } from "@graphql-tools/utils";
import { FIELD_TO_DEPENDENCY, type DependencyId } from "./dependencies.js";

export function loadFullSchemaDocument(): DocumentNode {
  const sdl = readFileSync(join(process.cwd(), "contracts/schema.graphql"), "utf-8");
  return parse(sdl);
}

function filterQueryFields(doc: DocumentNode, available: ReadonlySet<DependencyId>): DocumentNode {
  const definitions = doc.definitions.map((def) => {
    if (def.kind !== Kind.OBJECT_TYPE_DEFINITION || def.name.value !== "Query") {
      return def;
    }
    const queryDef = def as ObjectTypeDefinitionNode;
    const fields = (queryDef.fields ?? []).filter((field) => {
      const dep = FIELD_TO_DEPENDENCY[field.name.value];
      // 表里没登记的字段（理论上不该发生，schema.graphql 与
      // dependencies.ts 手工保持同步）视为始终注册，不静默裁掉——宁可
      // 暴露一个应该被裁的字段也不要莫名其妙裁掉一个没登记的字段。
      return dep === undefined || available.has(dep);
    });
    return { ...queryDef, fields };
  });
  return { ...doc, definitions };
}

export interface BuildSchemaOptions {
  available: ReadonlySet<DependencyId>;
  resolvers: IResolvers;
}

export function buildSchema({ available, resolvers }: BuildSchemaOptions) {
  const fullDoc = loadFullSchemaDocument();
  const filteredDoc = filterQueryFields(fullDoc, available);
  return makeExecutableSchema({
    typeDefs: filteredDoc,
    resolvers,
    // ⚠️ `resolvers/index.ts` 的汇总表永远是全量的（五个组件的全部
    // resolver 都在），而 typeDefs 按装配裁剪过——这两者"resolver 比
    // schema 多"是设计本身的常态，不是配置错误。`@graphql-tools/schema`
    // 默认会把"resolver 里有、schema 里没有的字段"当错误直接抛出
    // （真机测试第一次跑就抛 `Query.product defined in resolvers, but
    // not in schema`），这里显式放行。
    resolverValidationOptions: { requireResolversToMatchSchema: "ignore" },
  });
}
