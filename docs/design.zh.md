[English](design.md) · [中文](design.zh.md)

# infra/bff-mobile 设计

只写结论，给要改本组件设计的人看。怎么用：`BRICKKIT.zh.md`；代码怎么布局：`AGENTS.zh.md`。

## 边界

本组件是移动端 App 的聚合层：一个 GraphQL 查询喂满一个移动端页面，数据从拥有它的组件取来拼好。只做三件事：展示聚合、批量读防 N+1（DataLoader 绑 `BatchGet`）、按这次装配实际装了什么裁剪 schema。

| 不在这里 | 归谁 | 为什么 |
|---|---|---|
| 任何业务规则，再小也不行（"这张订单能不能取消"） | 拥有那份数据的组件 | 本层夹在前端与后端之间；规则放这里等于放前端 |
| 任何数据库、缓存表、持久化状态 | 各业务组件 | 缓存要失效，失效要懂业务含义；本组件最多只能有进程内、短命的缓存 |
| 判定谁能看哪些行 | 各下游的 REST 层 | 调用者的 token 原样转发；本组件不是数据的安全边界 |
| 编排写操作（先调 A 再调 B） | 业务组件 | 这里的写操作就是转发一次；再多就是带幂等、超时、补偿的编排，那些在业务组件里 |
| PC 端页面、打印 | PC 前端经网关；`infra/print` | 不同的客户端，不同的形状 |

它是后端组件（`tier: backend`）：服务端容器，不是交付给浏览器的东西。

## 拥有的数据

没有：没有表、没有 schema、没有登录角色。唯一的状态在进程里、重启即清：一次请求内的 DataLoader 批次，以及 SDK 持有的授权包。

| 看起来很合理的表 | 为什么不建 |
|---|---|
| 查询结果缓存 | 失效要懂业务含义（见边界） |
| 持久化查询注册表 | 清单是构建期产物，运行期只读；可写的注册表等于谁都能注册任意查询 |
| 用户偏好、最近浏览 | 那是别的组件的业务数据 |

## 契约面

GraphQL over HTTP，唯一端点 `POST /graphql`，另有 `/healthz`。不对外提供 gRPC，只当 gRPC 客户端。

**schema 手写**（`contracts/schema.graphql`），按移动端页面裁剪，不从各组件契约生成：所有契约的机械并集会让前端自己拼页面，BFF 存在的理由就没了。代价是下游契约变了不会自动传到 schema；靠映射代码与它的测试保持同步。

**按装配裁剪。** 启动时看哪些可选依赖注入了地址，把其余依赖的 `Query` / `Mutation` 字段去掉（`FIELD_TO_DEPENDENCY`）；一个写操作都不剩时 `Mutation` 类型整个消失。绝不留着字段返回 `null`：introspection 会把它公布出去，页面空白却不报错。这是前端看到的一半；菜单那一半（已装的功能）必须由同一份装配驱动。

**两条读路径，按数据来源的数据范围选：**

| 来源 | 路径 | 原因 |
|---|---|---|
| `mdm/customer`、`mdm/product`（`data_scopes: none`） | 经每请求一个的 DataLoader 走 gRPC `BatchGet`；产品搜索走 gRPC `List` 带 `q` | 主数据全员可见；把一页的 id 合成一次调用正是目的 |
| `erp/sales`、`erp/inventory`、`infra/workflow`、`infra/notification`、`crm/opportunity`（owner / org / 仓库范围） | REST，原样转发调用者的 `Authorization` | 组件之间的 gRPC 不按调用者过滤；只有 REST 层套数据范围，这里走 gRPC 就是把谁的数据都交出去 |

`inventoryBalance`、`order`、`task`、`opportunity` 按已知 id 读一行，没有 DataLoader。`inventoryBalances` 读 `GET /balances/list`（一个产品在调用者各仓库的余额）；`GET /balances` 保持单条的语义。`myOpportunities` 固定带 `view=mine`：移动端页面只看自己的商机；看部门的是 PC 端页面。

**写操作**：`approveTask`、`rejectTask`，各自是对 `infra/workflow` 的一次 `POST` 转发，返回处理后的待办详情。`idempotencyKey` 可选：客户端给了（每次用户操作一个、重试时原样再发）就作为 `idempotency_key` 转发，没给就不带这个字段。去重不靠它，因为 workflow 的 REST 层按状态去重：待办只会离开一次 `PENDING`，所以成功之后的重试得到 `CONFLICT`（"已处理，刷新"），绝不会第二次同意。以后任何写操作的判据：对一个组件调一次；调两次就是编排，退回业务组件。

**限制**（在 SDK 里写死）：深度 5、复杂度 100、只认持久化查询。清单（哈希 → 查询文本，Apollo APQ 形式）由移动端 App 的构建产出、随本组件镜像发布；仓库里的清单是空的，所以刚构建出来的镜像拒绝一切查询。前端与本组件一起发布。

**错误**：调用者能据此行动的下游拒绝以 `extensions.code` 保留原意，REST（`400` / `401` / `403` / `404` / `409`）与 gRPC 一样（`INVALID_ARGUMENT` / `FAILED_PRECONDITION` / `OUT_OF_RANGE` → `BAD_USER_INPUT`，`UNAUTHENTICATED`，`PERMISSION_DENIED` → `FORBIDDEN`，`NOT_FOUND`，`ALREADY_EXISTS` / `ABORTED` → `CONFLICT`：与 Go SDK 映射到 HTTP 的是同一组对应），并记一条 warn，写明依赖、路径或方法、状态。其余（`5xx`、`UNAVAILABLE`、连接被拒）掩盖成 `Unexpected error.` 并记成错误：只有这些需要运维。读操作回 `404` 是 `null`；写操作回 `404` 是 `NOT_FOUND` 错误，因为客户端必须知道这次操作没有发生。

**权限**：每组字段一个键，每个根字段都是 `requirePermission(key, resolver)`；resolver 目录不放别的东西，裸 resolver 扫描（`make module-check`、`make gates`）与 `test/resolvers.test.ts` 才查得了。

## 发布与消费的事件

不发布、不消费，也不连 NATS。事件用来改变某处的状态，而本组件不持有状态；一个只读聚合层要消费事件，通常意味着它偷偷缓存了不该缓存的东西。

## 依赖

全部可选（`optional: true`），因为本组件要在任何装配下都能启动：必需依赖等于宣布"没装那个组件就别用移动端"。

| 依赖 | 用来做什么 |
|---|---|
| `mdm/customer` | 按 id 取客户（gRPC `BatchGet`） |
| `mdm/product` | 按 id 取产品（gRPC `BatchGet`）、产品搜索（gRPC `List` 带 `q`） |
| `erp/sales` | 一张订单、我的订单（REST） |
| `erp/inventory` | 一条余额、一个产品的余额、仓库（REST） |
| `infra/workflow` | 我的待办、待办详情、同意、驳回（REST） |
| `infra/notification` | 我的通知（REST） |
| `crm/opportunity` | 我的商机、一条商机（REST） |

| 不是依赖 | 为什么 |
|---|---|
| 任何数据库、NATS | 没有自有数据，没有事件 |
| `infra/iam-casdoor` | token 在本地对着 `IAM_JWKS_URL` 的 JWKS 验签：是配置，不是依赖边；建边还会把 App 绑死在一个 IAM 上 |
| `infra/authz` | 权限包从 `AUTHZ_BUNDLE_URL` 轮询；判定是进程内查表 |
| `infra/print` | 打印是业务组件与前端经网关的事 |

两个 gRPC 来源的 `.proto` 从它们的发布 tag 只读拷贝进来（`contracts/vendor/SOURCES.tsv`），运行期由 `@grpc/proto-loader` 加载；不生成代码，不 import 任何别的组件的代码。

## 在同步调用图里的位置

根：七条出边、全部可选，没有组件指向它的入边（只有移动端 App 经网关调它）。它的下游是叶子枢纽（`mdm/*`、`erp/inventory`、`infra/workflow`、`infra/notification`）以及 `erp/sales` / `crm/opportunity`，后两者的出边都指向叶子，所以它不可能在环上。同时读 CRM 与 ERP 不违反"CRM 与 ERP 之间没有同步边"：那条规则约束的是业务组件；为展示跨域聚合正是 BFF 的本职。

## 分区与归档

不适用：没有持久化数据。

## 数据范围

本组件自己没有（`data_scopes: none`），但这不等于"不过滤"：每个有数据范围的字段都由下游的 REST 层按调用者的 token 回答，调用者看到的恰好就是 PC 端页面会给他看的。主数据在哪里都没有数据范围。

## 参考实现

| 项目 | 版本 | 看的模块 | 借鉴了什么 | 许可证 | 用法 |
|---|---|---|---|---|---|
| GraphQL Yoga | 5.22.0（经 be-sdk-ts） | 持久化查询插件 | 构建期白名单、拒绝未知哈希（不是运行期注册） | MIT | 借鉴逻辑 |
| graphql-armor | 3.2.0（经 be-sdk-ts） | 深度与复杂度限制 | 现成的限制，不自己写 | MIT | 借鉴逻辑 |
| DataLoader | 2.2.3 | 批处理与每请求缓存 | 每次请求一个 loader | MIT | 借鉴逻辑 |
| BFF 模式（Netflix、SoundCloud 的文章） | — | 一个前端一个后端 | BFF 按它的前端裁剪：支撑手写 schema | 文章 | 借鉴实际应用 |

**刻意避开**：联邦网关（Apollo Federation、GraphQL Mesh），它们自动组合多个团队的子图，等于把机械并集请回来；BFF 里加 Redis 缓存（失效要懂业务含义，项目也没有 Redis）；全局 DataLoader（一个用户的行给了另一个用户）；为了少一跳直接读数据库（会依赖每个组件的表结构）。

没有槽位族：GraphQL 还是 REST 聚合是一次性的技术选型，与前端的查询代码耦合，不是客户之间的差别。

## 未决问题

| 问题 | 目前的答案 |
|---|---|
| 持久化查询清单由谁产出，App 与本组件怎么一起定版本？ | 由移动端 App 的构建产出、拷进本镜像；发布耦合等移动端 App 有了之后写进部署流程 |
| 弱网下一个页面一个大查询，是否比几个小查询快？ | 待实测；判据是端到端首屏时间，不是请求数 |
| `infra/workflow` 的 REST 同意 / 驳回不认转发过去的 `idempotency_key`，按状态去重（成功后重试 → `CONFLICT`） | 安全（绝不会同意两次）；如果 App 要的是重放第一次的结果而不是 `CONFLICT`，得由 workflow 的 REST 层接受这个键 |
| 下游契约变了不会自动传到手写 schema 与 vendor 的 `.proto` | 靠对着桩的映射测试与对真实下游的端到端运行保持同步；没有建自动对比上游契约的检查 |
| Yoga 自己的错误日志（被掩盖的失败）是纯文本，不是 SDK 的 JSON 日志 | 暂且接受；服务端归 SDK，要改得由 SDK 把它接到 `rt.logger` |
