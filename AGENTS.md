# infra/bff-mobile

移动端展示聚合的代码。用法与边界在 `BRICKKIT.md`，为什么这样设计（术语、规则 BM01–BM11、取舍、未决问题）在 [docs/design.md](docs/design.md)；跨组件的规则在装配项目 be-assembly-standard 的协议 20（入口）、协议 09（决定直达属主）与决定 D68；错误的形状是线协议 P3.3，公网前缀是 P11.11。

## 代码地图

代码按模块分层。**先读这一节，再进目录**：每个代码目录都有自己的 `AGENTS.md`（同目录的 `CLAUDE.md` 让 Claude Code 读这个目录的文件时自动带上它），写这一层负责什么、不负责什么、每个文件、依赖谁、测在哪。

| 目录 | 是什么 |
| --- | --- |
| [`bffmobile/`](bffmobile/AGENTS.md) | 入口：组件定义与组装（一条路由交给 `internal/entry`）；不写业务。`main.go` 与外壳只引用它 |
| [`internal/`](internal/AGENTS.md) | 模块：下面各一个包；模块之间的依赖表在它的 `AGENTS.md` |
| [`itest/`](itest/AGENTS.md) | 集成测试（对属主的替身），按流程分文件；它的 `AGENTS.md` 是测试索引 |
| `main.go` | 单跑（`serve`）与构建时的清单校验 `check-manifest <文件>` |
| `cmd/seed/` | 种子（`make seed`）：角色“移动入口”给种子用户、审批人与销售；看到什么由各属主的种子与授予决定 |
| `contract/` | 本组件发布的契约：`schema.graphql`（生成代码的来源）、`openapi.yaml`（一条路由） |
| `gqlgen.yml` | 由 schema 生成执行器与模型（`make generate`） |
| `docs/design.md` | 设计（BM01–BM11） |

模块（`internal/` 下）：

| 模块 | 负责 |
| --- | --- |
| [`entry`](internal/entry/AGENTS.md) | 一条路由：入口操作、请求体、持久化查询、变量与上限、执行、错误映射成 P3.3 的 `extensions`、每个根字段的指标与追踪 |
| [`queries`](internal/queries/AGENTS.md) | 持久化查询清单：按（去掉没装的属主字段的）schema 逐条校验、深度、代价、别名、`limit`（纯函数） |
| [`reads`](internal/reads/AGENTS.md) | 每个读属主的字段一个函数：用户面、转发凭据、映射成 schema 的类型；一次请求内的仓库目录 |
| [`graph`](internal/graph/AGENTS.md) | gqlgen 生成的执行器与解析函数（解析函数只把参数交给 `reads`） |
| [`model`](internal/model/AGENTS.md) | gqlgen 生成的类型（不手改） |

共用的：[`core`](internal/core/AGENTS.md)（名字、资源与操作、属主与字段的对应、上限、`Base` 与转发凭据的读取）。

| 想改 | 从这里开始 | 然后 |
| --- | --- | --- |
| 加一个页面要的字段（同一属主） | `docs/design.md` 的“查询”、`contract/schema.graphql` | `make generate`；`internal/reads` 的映射；`internal/graph/schema.resolvers.go` 的解析函数 |
| 聚合一个新的属主组件 | `docs/design.md` 的“依赖”与 BM07 | `internal/core/names.go` 的 `Owners`、`FieldOwners`；`component.yaml` 的可选依赖；`internal/reads` 新文件；`itest/owners_integration_test.go` 的替身 |
| 上限、代价怎样算 | BM03 | `internal/queries` 的 `walk`；`internal/core` 的常量 |
| 错误给前端的样子 | BM06、BM09 | `internal/entry/errors.go` |

## 构建与测试

- `go test ./...`（`make test`）：清单的 `configSchema` 与 `events`、OpenAPI 与路由、合并安全（`bffmobile/contract_test.go`）；持久化查询的校验与上限（`internal/queries/queries_test.go`）；`check-manifest`（`main_test.go`）。
- `make test-integration`（`go test -tags integration ./itest/`）：对属主的替身，不要数据库与消息系统。
- `make generate`：改了 `contract/schema.graphql` 之后。
- `brickkit lint`

## 设计取舍

- **只读**：写操作由前端经边缘直接发给属主；本组件不管幂等、“结果未知”与多个写。
- **只走用户面、转发凭据**：属主按调用者判断；系统面不按调用者过滤，从不用它取用户看的数据。
- **只用 gqlgen 的执行器**：路由、准入、截止、访问日志都是 SDK 的；内省关闭，没有 APQ 登记。

## 易错点

- “我的”用已核验的调用者（`core.Principal`），不用变量；变量里没有、也不能有 `owner_id`。
- 属主答的 `detail` 不进答复（可能带内部的名字）；本组件自己的失败只写日志，客户端看到 `INTERNAL` 与追踪编号。
- 日志不记变量（可能带搜索词等个人数据）与凭据，只记查询的摘要与根字段。
- 根字段在 schema 里可以为空：非空的根字段失败会让整个 `data` 为空。
- 改了 schema 要 `make generate`；`internal/graph/schema.resolvers.go` 的函数体保留，新字段的解析函数要补。

## 改代码前自查

- 改了版本号吗？每次改动都升版本（`component.yaml` 与 `bffmobile/definition.go` 的 `Version`）。

<!-- brickkit:managed:begin lang=zh -->
## BrickKit

这是一个 BrickKit 组件：平台只读 `component.yaml`。它依赖的规则：

- `configSchema` 的键就是代码读的环境变量名。不能用保留名：`COMPONENT_ID`、`COMPONENT_VERSION`、`PORT`、`BRICKKIT_SERVED_MEMBERS`、`BRICKKIT_SERVED_MEMBERS_CONFIG`，以及任何 `*_ENDPOINT`。
- 依赖写精确版本。依赖的地址以 `<ID>_ENDPOINT` 注入；缺席的可选依赖根本没有这个变量，读的时候要带兜底。
- `/healthz` 只查本进程，不查依赖。迁移命令用同一个镜像跑，遇到不认识的参数必须直接失败；`local.migrationCommand` 从源码跑同一条迁移，给 `mode: local` 用。
- `BRICKKIT.md` 会随版本进入每个使用它的项目，在那里是脱离仓库单独读的：跟代码一起改，不放相对链接。
- 发版：改 `metadata.version`，提交、推送，`brickkit release`。`brickkit lint` 会检查清单和这些文档——在项目里、在这个目录下跑，只查这个组件（`--all` 查整个项目）。
- 完整规则在 `brickkit-component` 技能里（装了技能的项目或仓库根目录下的 `.claude/skills/brickkit-component/SKILL.md`；`brickkit skills update` 会装上）；参数问 `brickkit <命令> --help`；BrickKit 自己的文档用 `brickkit docs` 看。
<!-- brickkit:managed:end -->
