/**
 * buildSchema 的按装配裁剪逻辑——设计计划 §3.3：没装的组件对应的字段
 * 必须根本不注册（不是注册了返回 null），否则 introspection 会把字段
 * 暴露出去。
 */

import { describe, expect, it } from "vitest";
import { buildSchema } from "../src/schema.js";
import { DEP_MDM_CUSTOMER, DEP_MDM_PRODUCT, DEP_ERP_SALES } from "../src/dependencies.js";

const noopResolvers = {
  Query: {
    customer: () => null,
    customers: () => [],
    product: () => null,
    products: () => [],
    order: () => null,
    myOrders: () => ({ orders: [], nextCursor: "" }),
    inventoryBalance: () => null,
    myTasks: () => ({ tasks: [], nextCursor: "" }),
  },
};

describe("buildSchema", () => {
  it("全部弱依赖都装配时，Query 上五组字段全部注册", () => {
    const schema = buildSchema({
      available: new Set([DEP_MDM_CUSTOMER, DEP_MDM_PRODUCT, DEP_ERP_SALES]),
      resolvers: noopResolvers,
    });
    const fields = Object.keys(schema.getQueryType()!.getFields());
    expect(fields).toContain("customer");
    expect(fields).toContain("customers");
    expect(fields).toContain("product");
    expect(fields).toContain("order");
    expect(fields).toContain("myOrders");
    // erp-inventory/infra-workflow 没在 available 里，这组不该出现。
    expect(fields).not.toContain("inventoryBalance");
    expect(fields).not.toContain("myTasks");
  });

  it("没装的组件，对应字段在构建 schema 时根本不注册——不是注册了返回 null", () => {
    const schema = buildSchema({
      available: new Set([DEP_MDM_CUSTOMER]), // 只装 mdm-customer
      resolvers: noopResolvers,
    });
    const queryType = schema.getQueryType();
    expect(queryType).toBeDefined();
    const fields = Object.keys(queryType!.getFields());

    expect(fields).toContain("customer");
    expect(fields).toContain("customers");
    // mdm-product/erp-sales/erp-inventory/infra-workflow 都没装——
    // 对应字段必须完全不在 schema 里，不能是"存在但返回 null"。
    expect(fields).not.toContain("product");
    expect(fields).not.toContain("order");
    expect(fields).not.toContain("myOrders");
    expect(fields).not.toContain("inventoryBalance");
    expect(fields).not.toContain("myTasks");
  });

  it("什么都没装时，Query 仍然是一个合法的空壳（不报错）", () => {
    const schema = buildSchema({ available: new Set(), resolvers: noopResolvers });
    const queryType = schema.getQueryType();
    expect(Object.keys(queryType!.getFields())).toEqual([]);
  });
});
