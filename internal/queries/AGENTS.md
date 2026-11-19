# queries：持久化查询清单与上限

`docs/design.md` 的 BM02、BM03、BM07。纯函数：没有 I/O，入口把文件内容交进来。

## 负责与不负责

- 负责：`Schema`（从生成的 schema 来源载入一份新的，去掉不在部署里的属主的字段）；`Load`（清单是“摘要 → 查询文本”的 JSON 对象；逐条核对：键是文本的 SHA-256、按裁剪后的 schema 校验、只有一个查询操作、没有内省、字面的 `limit` 在 1–50、深度、别名、代价；不合的逐条拒绝、说明原因）；`Check`（完整 schema，给 `check-manifest`）；`Limits`（运行时：作为 `limit` 传入的变量在 1–50）。
- 不负责：读文件、写日志与指标（`entry`）；执行（`graph`）。

代价：读属主的字段（`FieldOwners` 里的）`CallCost`，其他带子选择的字段 `ObjectCost`，叶子不计；片段按展开计。深度：根字段是第 1 层。

## 文件

| 文件 | 内容 |
| --- | --- |
| `queries.go` | `Rejected`、`List`、`Load`、`Check`、`Schema`、`take`、`walk`、`Limits` |
| `queries_test.go` | 单元测试：字段与属主的对应、裁剪、各种拒绝、键与摘要、代价与别名、深度（用一个足够深的 schema）、运行时的 `limit` |

## 依赖与被依赖

- 依赖：`core`、`graph`（只用 `Sources`）、gqlparser。
- 被依赖：`entry`、`main.go`（`check-manifest`）。

## 测试

`go test ./internal/queries/`；拒绝与日志的端到端在 `itest/manifest_integration_test.go`。
