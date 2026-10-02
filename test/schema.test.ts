/**
 * buildSchema 的按装配裁剪：没装的组件对应的字段必须根本不注册（不是注册了
 * 返回 null），否则 introspection 会把字段暴露出去。
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
  // 与 resolvers/index.ts 一样带着 Mutation：裁掉整个 Mutation 类型之后，
  // 多出来的 Mutation resolver 不能让 buildSchema 报错。
  Mutation: {
    approveTask: () => null,
    rejectTask: () => null,
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

describe("buildSchema：新增字段按依赖裁剪", () => {
  const ALL = new Set([
    "mdm/customer",
    "mdm/product",
    "erp/sales",
    "erp/inventory",
    "infra/workflow",
    "infra/notification",
    "crm/opportunity",
  ] as const);

  function fieldsOf(available: ReadonlySet<string>) {
    const schema = buildSchema({ available: available as never, resolvers: noopResolvers });
    return {
      query: Object.keys(schema.getQueryType()!.getFields()),
      mutation: schema.getMutationType() ? Object.keys(schema.getMutationType()!.getFields()) : null,
    };
  }

  function without(dep: string) {
    return new Set([...ALL].filter((d) => d !== dep));
  }

  it("全部依赖都在时，新增的 Query 与 Mutation 字段全部注册", () => {
    const { query, mutation } = fieldsOf(ALL);
    for (const f of [
      "task",
      "myNotifications",
      "inventoryBalances",
      "warehouses",
      "searchProducts",
      "myOpportunities",
      "opportunity",
    ]) {
      expect(query).toContain(f);
    }
    expect(mutation).toEqual(expect.arrayContaining(["approveTask", "rejectTask"]));
  });

  it("缺 infra/notification 时没有 myNotifications，其余照常", () => {
    const { query } = fieldsOf(without("infra/notification"));
    expect(query).not.toContain("myNotifications");
    expect(query).toContain("myTasks");
    expect(query).toContain("myOpportunities");
  });

  it("缺 crm/opportunity 时没有 myOpportunities / opportunity", () => {
    const { query } = fieldsOf(without("crm/opportunity"));
    expect(query).not.toContain("myOpportunities");
    expect(query).not.toContain("opportunity");
  });

  it("缺 erp/inventory 时没有 inventoryBalances / warehouses", () => {
    const { query } = fieldsOf(without("erp/inventory"));
    expect(query).not.toContain("inventoryBalances");
    expect(query).not.toContain("warehouses");
  });

  it("缺 mdm/product 时没有 searchProducts", () => {
    expect(fieldsOf(without("mdm/product")).query).not.toContain("searchProducts");
  });

  it("缺 infra/workflow 时没有 task，也没有 Mutation 类型（一个写操作都不剩）", () => {
    const { query, mutation } = fieldsOf(without("infra/workflow"));
    expect(query).not.toContain("task");
    expect(mutation).toBeNull();
  });
});
