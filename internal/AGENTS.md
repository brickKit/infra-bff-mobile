# internal/：模块

移动聚合的模块，每个一个包。只给本仓库引用（Go 的 `internal`）：别的组件编译期就引用不了（决定 0101）。

## 模块

| 包 | 一句话 | 依赖（本组件内） |
| --- | --- | --- |
| `entry` | 一条路由：入口操作、持久化查询、上限、执行、错误映射、指标 | `core`、`graph`、`queries`、`reads` |
| `queries` | 持久化查询清单的校验与上限（纯函数） | `core`、`graph`（schema 的来源） |
| `graph` | 生成的执行器；解析函数交给 `reads` | `model`、`reads` |
| `reads` | 每个读属主的字段一个函数，映射成 schema 的类型 | `core`、`model` |
| `model` | 生成的类型 | — |
| `core`（共用） | 名字、资源与操作、属主与字段的对应、上限、`Base` | — |

分层（每个包只引用比它低的层，没有环）：

| 层 | 包 |
| --- | --- |
| 5 | `entry` |
| 4 | `queries` |
| 3 | `graph` |
| 2 | `reads` |
| 1 | `core`、`model` |

核对：`go list -f '{{.Imports}}' ./internal/<包>`。

## 共同的写法

- **读属主只经 `core.Base.Get`**：`GET`、转发调用者的凭据、失败时在 `metadata.dependency` 写上属主；不经系统面。
- **属主的答复先解进本包的结构，再映射成 `model` 的类型**：字段名按属主的契约（下划线），不把属主的 JSON 原样透出。
- **一次请求内的状态放在上下文里**（`reads.WithRequest`），请求结束即丢；包级变量只放常量与生成的 schema。

## 测试

`queries` 有单元测试；其余由 `itest/` 的流程测试覆盖。
