# infra-bff-mobile · AI 助手导读

## 身份证

| 项 | 值 |
|---|---|
| 组件 ID | `infra/bff-mobile` |
| 仓库名 | `infra-bff-mobile` |
| 端口 | HTTP `8500`（**无 gRPC**），`exposePort=28500`（合并部署走 Traefik file provider，决策 107） |
| schema / role | **无**（§6.5 铁律二：严禁直连 DB） |
| 语言 / 框架 | **TypeScript**（全系统第一个）：GraphQL Yoga + DataLoader + `be-sdk-ts` |
| 合并部署时进 | **不进任何外壳**（§13.5：跨语言合不进来），保持独立容器 |
| 装配角色 | `default` |
| 设计真相源 | 装配仓库 `docs/design/infra-bff-mobile.md`——本文件与它冲突时，以那份为准，回来改这里 |

## 边界

**归我：** 展示聚合（一个页面一次查询）、防 N+1（DataLoader 绑定 `batchGet`）、弱网优化（Persisted Queries）、按装配裁剪 schema。

**不归我：**

| 什么 | 归谁 | 为什么 |
|---|---|---|
| **任何业务逻辑** | 各业务组件 | §6.5 铁律一，包括看起来无害的判断（"能不能取消"要问 `erp-sales`） |
| **任何数据库** | 各业务组件 | §6.5 铁律二，我一张表都没有 |
| 鉴权判定本身 | 各业务组件的 `be-sdk` | 我透传 JWT，下游各自判；我不是安全边界 |
| 写操作的编排 | 业务组件 | 本阶段只做 query，见 §3.2 |

⚠️ **`data_scopes: none`，但不等于"下游会用 gRPC 转发的 JWT 自己过滤"**：全项目的 gRPC 组件间协议统一不做数据权限过滤，真正的 org/owner/warehouse 过滤只在各自 REST 面的 `besdk.ScopeOf` 生效。本组件对有真实数据权限的字段（订单/库存/待办）改走 REST 转发，对 `data_scopes: none` 的字段（客户/产品）才走 gRPC BatchGet（见 `contracts/schema.graphql` 顶部注释）。

## 契约面与事件

**gRPC：无。** 只作为客户端调 `mdm-customer`/`mdm-product`，不对外提供 gRPC。

**对外：GraphQL over HTTP，单一端点 `POST /graphql`。** `GET /healthz` 之外没有别的 REST 路径。schema 手写在 `contracts/schema.graphql`，不是从 proto 生成的——这是刻意的，BFF 存在的意义就是按前端页面裁剪，不是 62 个组件契约的机械并集。

**发布/消费事件：都没有。** 不持有任何状态，`component.yaml` 连 `kind: mq` 的资源依赖都不声明。

## 依赖与「为什么不依赖某某」

五条弱依赖（全部 `optional: true`）：`mdm/customer`、`mdm/product`、`erp/sales`、`erp/inventory`、`infra/workflow`。

⚠️ **一条强依赖都不能有，这是本组件形态决定的**：客户只买了一部分组件，本组件要在任何装配组合下都能起来。把任何组件写成强依赖，等于宣布"没买它就别想用移动端"。

**明确不依赖：**

| 谁 | 为什么不建依赖边 |
|---|---|
| 任何数据库 / NATS | §6.5 铁律二 + §4 |
| `infra-iam-casdoor` | 验签走 `iamJwksUrl` 配置项，建依赖边会废掉 `slot:iam` 槽位机制 |
| `infra-authz` | `authzBundleUrl` 配置项，不是依赖边——判定是 `be-sdk-ts` 的进程内 map 查找 |
| `infra-print` | 打印是业务组件的事，前端直接走网关要 PDF |

## 这个组件特有的坑

| 不许 | 症状 | 出处 |
|---|---|---|
| 给有真实数据权限的字段（订单/库存/待办）用 `besdk.userClient` 走 gRPC | **真实的数据权限缺口**：全项目的 gRPC 组件间协议统一不做数据权限过滤，`query { order(id: "别人的订单id") { ... } }` 会直接查到——这是阶段三 Task 11 实现时发现、用户明确拍板要走 REST 转发的原因 | `contracts/schema.graphql` 顶部注释、`src/clients/restForward.ts` |
| 给新的 Query 字段忘了在 `src/dependencies.ts` 的 `FIELD_TO_DEPENDENCY` 登记 | 没装对应组件时这个字段还是会出现在 schema 里，`introspection` 暴露出去，前端按 schema 写了查询、运行时永远拿 null（"页面空白但不报错"，设计计划 §3.3 原文点名的症状） | `src/schema.ts` |
| 在 `resolvers/` 目录下写没经过 `requirePermission(...)` 包装的裸字段 | `make gates`/`make module-check` 的裸 resolver 扫描会拦，但手滑加一个新字段时最容易漏 | `src/resolvers/index.ts`、`Makefile` 的 `module-check` |
| DataLoader 做成模块级单例（比如在 `src/clients/customer.ts` 顶层 `new DataLoader(...)`） | 跨请求缓存命中，A 用户看到 B 用户的数据，且单请求测试永远测不出来——`src/context.ts` 的 `buildContext` 每次请求现造是唯一正确用法 | `src/context.ts` |
| 假设 `@grpc/proto-loader` 加载出来的字段是 snake_case | 默认 `keepCase: false` 会转 camelCase，`enums: "String"` 会给字符串枚举名（带 `CUSTOMER_STATUS_` 前缀，要手动剥掉）——两边都要跟真实响应核对，不能靠读 `.proto` 文件猜字段名 | `src/clients/grpcProto.ts`、`customer.ts`/`product.ts` 的 `stripEnumPrefix` |
| 依赖 `be-sdk-ts` 的 `userClient` 会自动把身份塞进 ChannelCredentials | **真机踩过的真实 bug**：`@grpc/grpc-js` 故意拒绝把 CallCredentials 组合进 insecure ChannelCredentials（`Cannot compose insecure credentials`），`be-sdk-ts@0.3.3` 已改用 Interceptor 修复；确认依赖的 `besdk` 版本不低于这个 | 根 `docs/dev/实测踩坑记录.md` A11 |
| 往 `makeExecutableSchema` 传全量 resolvers 时不设 `resolverValidationOptions` | `resolvers/index.ts` 的汇总表永远是全量的，schema 按装配裁剪过——"resolver 比 schema 多"是设计本身的常态，不设 `requireResolversToMatchSchema: "ignore"` 会直接抛异常 | `src/schema.ts` |

## 改代码前的自查

1. **我加的这个字段，数据来源组件是不是 `data_scopes: none`？** 不是的话必须走 REST 转发，不能抄 customer/product 那种 gRPC BatchGet 的模式——那会绕开数据权限。
2. **我加的字段，是不是忘了在 `src/dependencies.ts` 登记？** 停下——漏登记的字段永远不会被裁剪，没装对应组件时 introspection 还是能看到它。
3. **我写的 resolver 是不是没经过 `requirePermission(...)` 包装？** 停下——`make module-check` 会拦，但先自己看一眼更快。
4. **我是不是在某个 `clients/` 文件的模块顶层 `new DataLoader(...)`？** 停下——DataLoader 必须每请求现造，见 `src/context.ts`。
5. **我改的是不是 mutation？** 停下——本阶段只做 query，真要加必须是"纯转发，一出现先调 A 再调 B 就退回业务组件"这条判据。
