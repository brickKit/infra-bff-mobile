# entry：一条路由

`docs/design.md` 的 BM01、BM02、BM03、BM06、BM08、BM09、BM11。

## 负责与不负责

- 负责：`New`（部署里有的属主、读清单（没有或读不了时拒绝一切查询，成员照常启动）、逐条拒绝写告警日志 `event=bff_query_rejected` 与指标、建执行器）；`Serve` 的顺序：入口操作（没有答 403，什么也不调）→ 请求体（只认持久化查询的形式，多余的成员拒绝；数字按 `json.Number` 解，gqlgen 才认得整数）→ 清单里找摘要（没有答 `PERSISTED_QUERY_NOT_FOUND`）→ 变量（类型不对 400）→ `limit`（400 带 `violations`）→ 执行 → 200；错误映射（`present`：P3.3 的 `reason`、`domain`、`metadata`、`trace_id`，可重试或“先查询”的原因带 `retry_after`，从不带属主的 `detail`；本组件自己的失败写日志、给 `INTERNAL`）；每个根字段的耗时、按原因的结果计数与追踪的 span（标签是字段与查询的摘要，不记变量）。
- 不负责：哪些条目合格（`queries`）；读属主（`reads`）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `entry.go` | `ErrNotFound`、`Entry`、`New`、`load`、`Serve`、请求体、`recover` |
| `errors.go` | `present`、`retryAfter` |
| `metrics.go` | 成员自己的指标（`bff_mobile_field_total`、`bff_mobile_field_seconds`、`bff_mobile_query_rejected_total`）、`rootField` |

## 依赖与被依赖

- 依赖：`core`、`graph`、`queries`、`reads`；SDK 的 `authz`、`errs`、`httpx`、`runtime`；gqlgen 的 `executor`、`lru`。
- 被依赖：入口包 `bffmobile`。

## 测试

`itest/entry_integration_test.go`（入口的拒绝）、`itest/missing_integration_test.go`（错误的形状）、`itest/manifest_integration_test.go`（拒绝的日志、日志里没有变量与凭据）。
