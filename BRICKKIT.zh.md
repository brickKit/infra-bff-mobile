# infra/bff-mobile

## 组件定位

移动端 App 的 GraphQL 聚合层（BFF）：一个查询喂满一个移动端页面，数据从持有它的组件取来拼好。没有业务逻辑，也没有数据库；它展示的每一样东西都由别的组件拥有、由别的组件判定。

**负责**

- 移动端 GraphQL schema：手写、按移动端页面裁剪（`contracts/schema.graphql`），唯一端点 `POST /graphql`。
- 按装配裁剪 schema：对应组件没装的字段根本不在 schema 里。
- 批量读（一个页面的客户或产品，一次请求一个 gRPC `BatchGet`）与查询限制：深度 5、复杂度 100、只认持久化查询。
- 每组字段一个权限键（`infra.bff-mobile.*`），在调任何下游之前检查。

**不负责**

- 任何业务规则，包括看起来很小的（"这张订单能不能取消"由 `erp/sales` 回答）：归拥有那份数据的组件。
- 谁能看哪些行：每个下游组件的 REST 层按调用者的 token 套自己的数据范围，本组件原样转发这个 token。
- 审批逻辑、通知投递、库存、订单、商机、主数据：分别归 `infra/workflow`、`infra/notification`、`erp/inventory`、`erp/sales`、`crm/opportunity`、`mdm/customer`、`mdm/product`。
- 移动端允许发哪些查询（持久化查询清单）：由移动端 App 的构建产出，随本组件的镜像发布，或在部署时经 `PERSISTED_OPERATIONS_JSON` 给出。
- PC 端页面与打印：PC 前端经网关直接调各组件；打印归 `infra/print`。

## 部署前准备

- **不连数据库、不连 NATS、不用对象存储。** 什么都不用建。
- **授权**（`infra/authz`）与**身份**（`infra/iam-casdoor`，或任何提供 JWKS 的 IAM）要能在 `AUTHZ_BUNDLE_URL`、`IAM_JWKS_URL` 访问到，否则每个字段都只回错误。它们是配置，不是依赖：没有它们组件照样启动。
- **持久化查询清单**（哈希 → 查询文本）必须装着移动端 App 的查询。要么构建进镜像（`contracts/persisted-operations.json`），要么部署时用 `PERSISTED_OPERATIONS_JSON: file://<清单文件>` 给出，它整份替换镜像里的那份。仓库里是空清单，两样都没有时拒绝一切查询。清单与移动端 App 一起发布。
- **网关**把 `/graphql` 路由到本组件（`assembly.yaml` 里的网关路由）。

## 依赖说明

全部可选。缺了哪个都不挡启动：只是它对应的字段不在 schema 里（introspection 看不到，查询里写了这个字段就校验失败）。

| 依赖 | 用来做什么 | 缺席时消失的字段 |
|---|---|---|
| `mdm/customer` | gRPC `BatchGet` 取客户 | `customer`、`customers` |
| `mdm/product` | gRPC `BatchGet` 取产品；gRPC `List` 带 `q` 做搜索 | `product`、`products`、`searchProducts` |
| `erp/sales` | REST `GET /orders/{id}`、`GET /orders` | `order`、`myOrders` |
| `erp/inventory` | REST `GET /balances`、`GET /balances/list`、`GET /warehouses` | `inventoryBalance`、`inventoryBalances`、`warehouses` |
| `infra/workflow` | REST `GET /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/approve`、`POST /tasks/{id}/reject` | `myTasks`、`task`、`approveTask`、`rejectTask`（以及整个 `Mutation` 类型） |
| `infra/notification` | REST `GET /notifications` | `myNotifications` |
| `crm/opportunity` | REST `GET /opportunities?view=mine`、`GET /opportunities/{id}` | `myOpportunities`、`opportunity` |

主数据（`data_scopes: none`）走 gRPC。凡是有行级数据范围的都走 REST，原样转发调用者的 `Authorization` 头：只有各组件的 REST 层套数据范围，组件之间的 gRPC 不按调用者过滤。

授权包与 JWKS 从配置里的 URL 取，不经依赖边。没有它们时每个字段都失败关闭：没有或无效的 token → `401`；`IAM_JWKS_URL` 为空 → `403`；JWKS 不可达 → `401`（token 验不了）；授权包从启动到现在一次都没取到 → `503`；有效用户但没有该字段的权限键 → `403`。`/healthz` 始终 `200`：它只报告本进程活着。

## 配置指南

| 变量 | 含义 |
|---|---|
| `AUTHZ_BUNDLE_URL` | 权限检查轮询的授权包 URL，例如 `http://infra-authz-2-0-0:8223/authz/bundle`。必填：没有它每个字段都回 `503`。与项目里运行的 authz 版本保持一致。 |
| `IAM_JWKS_URL` | 本地验用户 token 用的 JWKS URL，例如 `http://infra-iam-casdoor-2-0-0:8200/.well-known/jwks.json`。必填：没有它每个字段都回 `403`。 |
| `OTEL_BASE_URL` | OpenTelemetry collector 的基础 URL；为空（默认）时什么都不导出。 |
| `PERSISTED_OPERATIONS_JSON` | 持久化查询清单本身，JSON 对象（哈希 → 查询文本），一般写成 `file://<清单文件>`，由平台注入文件内容。为空（默认）时用镜像里的清单。给了就整份替换那份清单（不合并）；值不是"字符串到字符串"的 JSON 对象时组件启动失败。它只改变允许哪些查询，不改变"只认清单里的查询"。 |

依赖的地址由平台注入（`<ID>_ENDPOINT`，`mdm/customer` 与 `mdm/product` 的 gRPC 端口是 `<ID>_GRPC_ENDPOINT`），不需要配置。

## 契约索引

- `contracts/schema.graphql` —— GraphQL schema，端点 `POST /graphql`。Query：`customer`、`customers`（`infra.bff-mobile.customer.view`）；`product`、`products`、`searchProducts`（`infra.bff-mobile.product.view`）；`order`、`myOrders`（`infra.bff-mobile.order.view`）；`inventoryBalance`、`inventoryBalances`、`warehouses`（`infra.bff-mobile.inventory.view`）；`myTasks`、`task`（`infra.bff-mobile.task.view`）；`myNotifications`（`infra.bff-mobile.notification.view`）；`myOpportunities`、`opportunity`（`infra.bff-mobile.opportunity.view`）。Mutation：`approveTask`、`rejectTask`（`infra.bff-mobile.task.act`），各带一个可选的、客户端生成的 `idempotencyKey`：给了就原样转发，没给就不带（workflow 按待办状态去重，不靠它）。列表按游标分页（`cursor`、`pageSize`、`nextCursor`）；金额与数量是十进制字符串。下游拒绝表现为字段错误，`extensions.code` 是 `UNAUTHENTICATED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT` 或 `BAD_USER_INPUT`；其余失败是通用的 `Unexpected error.`。只接受持久化查询清单里的查询（Apollo APQ 形式，`extensions.persistedQuery.sha256Hash`）。
- `assembly.yaml` —— 本项目的元数据：上面八个权限键、网关路由 `/graphql`、`data_scopes: none`。
- `contracts/vendor/` —— `mdm/customer`、`mdm/product` 的 `.proto` 只读拷贝，取自它们的发布 tag；不是本组件的契约。
- 事件：不发布，不消费。

## 外壳声明

不是外壳，也从不被外壳托管：外壳是 Go 与 Python 进程，TypeScript 模块合不进去。它始终是独立容器。
