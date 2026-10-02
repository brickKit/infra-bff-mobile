/**
 * 全部 resolver 的汇总。本目录只放 resolver：`make gates` 的 bare-route-scan 与
 * `make module-check` 扫的就是这个目录，每个字段的值都必须是
 * `requirePermission(...)` 包过的。
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
