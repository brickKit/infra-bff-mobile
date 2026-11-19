# reads：读属主

`docs/design.md` 的 BM04、BM05 与“查询”一节：每个读属主的字段一个函数。

## 负责与不负责

- 负责：调哪个属主的哪个用户面路径、带哪些参数（游标原样、`limit` 每次显式传、筛选只传设了的）；把属主的答复（按它的契约）映射成 `model` 的类型（`_masked` 成 `masked`，从不为空；译文原样）；“我的”按 `core.Principal` 筛选；一次请求内只读一次的仓库目录（`WithRequest`、`catalog`），可用量的仓库名称取不到时可用量照常、名称为空、带一个警告错误。
- 不负责：谁能看什么（属主）；错误的形状（`entry`）；字段注不注册（`queries`）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `reads.go` | `Reads`、`New`、`DefaultLimit`、`page`、`masked` |
| `tasks.go` | `MyTasks`、`Task`（`infra/workflow`） |
| `notifications.go` | `MyNotifications`（`infra/notification`） |
| `products.go` | `Products`、`Product`（`mdm/product`） |
| `stock.go` | `WithRequest`、仓库目录、`Stock`（`erp/inventory`） |
| `partners.go` | `Customers`、`Customer`（`mdm/partner`，客户角色） |
| `sales.go` | `MyOrders`、`Order`（`erp/sales`）；`mine`；单据上的客户快照 |
| `opportunities.go` | `MyOpportunities`、`Opportunity`（`crm/opportunity`） |

## 依赖与被依赖

- 依赖：`core`、`model`。
- 被依赖：`graph`（解析函数）、`entry`（`WithRequest`）。

## 测试

`itest/reads_integration_test.go`（映射、转发的凭据与参数、仓库目录一次）、`itest/missing_integration_test.go`（属主失败）。
