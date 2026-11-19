# infra/bff-mobile 的契约

组件 `infra/bff-mobile`（移动端展示聚合）对外发布的契约，随组件的版本发布：

| 文件 | 内容 |
| --- | --- |
| `schema.graphql` | 只读的 GraphQL schema：移动页面的查询（待办、通知、产品与库存、客户、我的订单、我的商机）；没有变更与订阅。代码由它生成（`make generate`） |
| `openapi.yaml` | 用户面的一条路由 `POST /api/bff-mobile/graphql`：持久化查询的请求体、答复与入口自己的拒绝；它的操作（`x-operation`） |

本组件不发布事件，没有系统面。一个部署里实际可用的字段是 schema 去掉没装的属主组件的字段（`docs/design.md` 的 BM07）。
