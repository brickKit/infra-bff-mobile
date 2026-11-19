# core：共用的名字与读取

每个模块都用的东西。不含规则的执行。

## 负责与不负责

- 负责：组件 ID 与错误的领域；配置键；资源 `infra.bff_mobile.entry` 与操作 `infra.bff_mobile.entry.use`（`Definitions`）；被聚合的属主（`Owners`）与每个读属主的字段属于谁（`FieldOwners`，BM07 按它裁剪 schema、BM03 按它计代价）；上限的常量；`Base`（部署里有的属主的客户端）、`Base.Get`（用户面、`GET`、转发凭据、失败时写上属主）、`Principal`（已核验的调用者）。
- 不负责：一个字段怎样映射（`reads`）；清单与上限的判断（`queries`）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `names.go` | `ID`、`Domain`、`KeyQueries`、`Entry`、`OpEntry`、属主的 ID、`Owners`、`FieldOwners`、上限、仓库目录的页数、`Definitions` |
| `base.go` | `Base`、`NewBase`、`Has`、`Get`、`Principal` |

## 依赖与被依赖

- 依赖：SDK（`authz`、`calls`、`errs`、`runtime`）。
- 被依赖：所有模块。

## 测试

`internal/queries/queries_test.go` 核对 `FieldOwners` 与 schema 一致；`Get` 的转发由 `itest/` 覆盖。
