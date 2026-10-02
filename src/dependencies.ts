/**
 * 每个 Query 字段归哪个可选依赖：`schema.ts` 按这张表在构建 schema 时裁掉
 * 这次装配没有的组件对应的字段。
 *
 * ⚠️ 新增字段必须在这里登记，否则它永远不会被裁掉：没装对应组件时前端
 * introspection 照样看得到它，按 schema 写了查询、运行时永远拿到 null，
 * 症状是"页面空白但不报错"。
 */

import type { Config } from "besdk";

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

/** 看这次装配里每个可选依赖的地址有没有注入（缺席的依赖不注入任何变量），返回装了哪些。 */
export function resolveAvailableDependencies(config: Config): Set<DependencyId> {
  const available = new Set<DependencyId>();
  for (const dep of ALL_DEPENDENCIES) {
    if (config.endpoint(dep).ok) {
      available.add(dep);
    }
  }
  return available;
}
