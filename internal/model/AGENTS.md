# model：生成的类型

gqlgen 由 `contract/schema.graphql` 生成的 Go 类型（`make generate`，`gqlgen.yml` 的 `model`）。**不手改**：改 schema 再生成。单独成包，是为了让 `reads` 映射成这些类型而不引用执行器（`graph` 引用 `reads`，放在一起会成环）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `models.go` | schema 的对象类型（`TaskPage`、`WorklistTask`、`ProductDetail`、`StockPosition` 等）；可为空的字段是指针 |

## 依赖与被依赖

- 依赖：没有。
- 被依赖：`reads`、`graph`。

## 测试

没有自己的测试；由 `itest/` 覆盖。
