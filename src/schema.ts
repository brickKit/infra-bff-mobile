/**
 * 从 `contracts/schema.graphql`（唯一真相源，随组件分发的 api-contract）解析出
 * 完整 schema，再按这次装配实际有哪些可选依赖裁掉对应的字段。裁掉是"根本不在
 * schema 里"，不是"注册了返回 null"：否则 introspection 会把字段暴露出去，
 * 前端按 schema 写了查询、运行时永远拿到 null（"页面空白但不报错"）。
 *
 * 只裁根类型的字段，不清理因此没人引用的类型定义：GraphQL 允许 schema 里有
 * 无人引用的类型，不影响可查询的表面。
 *
 * 读文件按工作目录找，不用 `__dirname` / `import.meta.url` 反推：工作目录由
 * 调用方保证是仓库根（容器 WORKDIR、本地运行时的仓库目录），与 build 产物
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
      // 表里没登记的字段（schema.graphql 与 dependencies.ts 手工保持同步，
      // 理论上不该出现）始终注册：宁可多暴露一个该裁的字段，也不要莫名其妙
      // 裁掉一个没登记的字段。
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
    // `resolvers/index.ts` 的汇总表永远是全量的，typeDefs 按装配裁过，
    // "resolver 比 schema 多"是常态。@graphql-tools/schema 默认把它当错误抛
    // （`Query.product defined in resolvers, but not in schema`），这里放行。
    resolverValidationOptions: { requireResolversToMatchSchema: "ignore" },
  });
}
