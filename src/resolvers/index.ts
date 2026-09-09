/**
 * 全部 resolver 的汇总——本目录不放别的东西（设计计划 §9 待决问题 1）：
 * `make gates` 的裸 resolver 扫描认的就是这个目录，每个字段值必须是
 * `requirePermission(...)` 包过的，扫描器按这条判违规。
 */

import type { IResolvers } from "@graphql-tools/utils";
import { customerResolvers } from "./customer.js";
import { productResolvers } from "./product.js";
import { orderResolvers } from "./order.js";
import { inventoryResolvers } from "./inventory.js";
import { taskResolvers } from "./task.js";

export const resolvers: IResolvers = {
  Query: {
    ...customerResolvers,
    ...productResolvers,
    ...orderResolvers,
    ...inventoryResolvers,
    ...taskResolvers,
  },
};
