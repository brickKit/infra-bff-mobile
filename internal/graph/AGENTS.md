# graph：生成的执行器与解析函数

gqlgen 由 `contract/schema.graphql` 生成（`make generate`，配置 `gqlgen.yml`）。

## 负责与不负责

- 负责：执行一个已解析的查询（根字段并行，嵌套的 `ProductDetail.stock` 是单独的解析函数）；解析函数只把参数交给 `reads`，`Stock` 另把仓库名称的警告加进错误。
- 不负责：读属主、映射（`reads`）；HTTP、授权、清单（`entry`、`queries`）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `generated.go` | 生成的执行器（不手改） |
| `schema.resolvers.go` | 解析函数（生成时保留函数体） |
| `resolver.go` | `Resolver`（持有 `reads.Reads`） |
| `sources.go` | `Sources`：生成代码里的 schema 来源，给 `queries` 裁剪用 |

## 依赖与被依赖

- 依赖：`model`、`reads`、gqlgen。
- 被依赖：`entry`、`queries`。

## 测试

由 `itest/` 覆盖。
