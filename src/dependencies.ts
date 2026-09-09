/**
 * 每个 Query 字段归哪个弱依赖——`schema.ts` 按这张表在构建 schema 时
 * 裁剪掉没装的组件对应的字段（设计计划 §3.3）。
 *
 * ⚠️ 新增一个 Query 字段时必须同步在这里登记，否则它永远不会被裁剪掉
 * ——没装对应组件时前端 introspection 还是能看到这个字段，症状正是
 * 设计计划 §3.3 点名的"页面空白但不报错"。
 */

import { endpoint } from "besdk";

export const DEP_MDM_CUSTOMER = "mdm/customer";
export const DEP_MDM_PRODUCT = "mdm/product";
export const DEP_ERP_SALES = "erp/sales";
export const DEP_ERP_INVENTORY = "erp/inventory";
export const DEP_INFRA_WORKFLOW = "infra/workflow";

export const ALL_DEPENDENCIES = [
  DEP_MDM_CUSTOMER,
  DEP_MDM_PRODUCT,
  DEP_ERP_SALES,
  DEP_ERP_INVENTORY,
  DEP_INFRA_WORKFLOW,
] as const;

export type DependencyId = (typeof ALL_DEPENDENCIES)[number];

export const FIELD_TO_DEPENDENCY: Record<string, DependencyId> = {
  customer: DEP_MDM_CUSTOMER,
  customers: DEP_MDM_CUSTOMER,
  product: DEP_MDM_PRODUCT,
  products: DEP_MDM_PRODUCT,
  order: DEP_ERP_SALES,
  myOrders: DEP_ERP_SALES,
  inventoryBalance: DEP_ERP_INVENTORY,
  myTasks: DEP_INFRA_WORKFLOW,
};

/** 读一遍全部弱依赖的 `*_ENDPOINT`，返回这个装配环境里真的装了哪些。 */
export function resolveAvailableDependencies(): Set<DependencyId> {
  const available = new Set<DependencyId>();
  for (const dep of ALL_DEPENDENCIES) {
    if (endpoint(dep).ok) {
      available.add(dep);
    }
  }
  return available;
}
