# itest/：集成测试与测试索引

移动聚合经它真实的用户面、对着被聚合组件的替身的测试（L2）。替身按各属主发布的契约（它的 `contract/openapi.yaml` 与引用的事件 schema；平台原因的领域是 `be`，与真实属主的 `errs.New` 一样）答复，记下被问了什么、带的是谁的凭据，可以变慢或拒绝。构建标签 `integration`；一条流程一个文件。

## 怎样跑

- `make test-integration`（`go test -count=1 -tags integration ./itest/`），约五秒；不要数据库与消息系统（本组件都没有）。
- 端口 29500（全部属主）与 29509（没有 `crm/opportunity` 与 `erp/inventory` 的部署）要空着（不用注册表的 28500：本机部署可能暴露它）；替身用随机端口。
- **只有一个测试** `TestBffMobileEndToEnd`，按下表的顺序跑各步。

## 文件

| 文件 | 步 | 测的流程 | 规则 |
| --- | --- | --- | --- |
| `entry_integration_test.go` | `entry` | 没有入口操作 403、没有凭据 401、不认识的摘要与登记在错摘要下的条目、不是持久化查询的请求体、`limit` 超出 1–50、`extensions` 里多余的成员、变量类型不对与缺必填变量，都在问任何属主之前拒绝 | BM01–BM03 |
| `reads_integration_test.go` | `reads` | 待办与通知一次取齐、映射；下一页的游标原样带回、`limit` 显式传；任务按组件与身份；被屏蔽的字段为 `null`、`masked` 用 GraphQL 字段名（伙伴的 `taxId`、归档订单的 `customer` 与 `total`）；可用量的仓库目录一次一请求、位置的第二页也取、看不见的仓库没有名称、产品列表与不要库存的详情不调库存；客户按角色与法人；我的订单与商机按已核验的调用者筛选；每个请求都是 `GET`、带调用者自己的凭据 | BM04、BM05 |
| `missing_integration_test.go` | `missing` | 根字段并行；慢的属主只有它的字段为空并带原因、属主与 `retry_after`，在路由截止前答复；属主的 `NOT_FOUND` 原样（领域 `be`、不带 `metadata.dependency`）；属主不认转发的凭据答 `AUTHORIZATION_UNPROVABLE`；库存取不到（不带协议体的 503）时产品照常、可用量为空并写明属主；仓库目录取不到时可用量照常、名称为空；没装的属主的字段不可用 | BM06、BM07 |
| `bounds_integration_test.go` | `bounds` | 仓库目录超过 5 页：已取的照常命名、带缺件错误；库存位置超过 5 页：已取的照常返回、带缺件错误并写明属主，不静默截断；按 id 读取的参数不是 UUID：字段答 `REQUEST_INVALID`，不问属主 | BM05、BM04 |
| `manifest_integration_test.go` | `manifest` | 清单里不合的条目（变更、订阅、内省、不认识的字段、字面 `limit` 100、11 个别名、代价 210、两个操作、错摘要）逐条拒绝、日志里的原因各自对得上，成员照常启动；小部署拒绝用到没装属主的条目；日志里没有变量与凭据 | BM02、BM03、BM07、BM11 |

共用的：

| 文件 | 内容 |
| --- | --- |
| `endtoend_integration_test.go` | `TestBffMobileEndToEnd`；`fixture`（两个运行中的成员、替身、日志）；`start`、`run`；持久化查询 `queries` 与要被拒的 `refused`、`persisted`；替身 `standIn`（记录、`set` 换答复、`forget`）；`client`（`query`、`byHash`、`post`）、`answer.errorAt`、`portFree` |
| `owners_integration_test.go` | 替身按各属主契约的答复与固定的身份 |

## 加测试

新流程加一个文件与一步，在 `TestBffMobileEndToEnd` 里排进顺序，在上表加一行；测试不为了通过而改。
