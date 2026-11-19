# bffmobile/：入口与组装

组件对外的一个包：`main.go` 与外壳只引用它（`bffmobile.Definition()`、`bffmobile.New`）。这里只**组装**：把一条路由交给 `internal/entry`；业务一行也不写。

## 负责与不负责

- 负责：组件的身份与版本、自己的配置键（`BFF_PERSISTED_QUERIES`）与它在清单里的说明、路由与它的操作。
- 不负责：执行与校验（[internal/AGENTS.md](../internal/AGENTS.md)）；名字（`internal/core/names.go`）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `definition.go` | `Version`、`Keys` 与 `Own`；`Definition()`（没有迁移、事件、系统面） |
| `module.go` | `Module` 与 `New`（交给 `entry.New`）；`Path`；`Routes`（一条） |
| `contract_test.go` | 单元测试：清单的 `configSchema` 与 `events`、OpenAPI 与路由一一对应、合并安全（含 `internal/` 与生成的代码） |

## 依赖与被依赖

- 依赖：`internal/core`、`internal/entry`。
- 被依赖：`main.go`、外壳、`itest/`。

## 测试

`go test ./bffmobile/`。
