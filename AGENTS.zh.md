[English](AGENTS.md) · [中文](AGENTS.zh.md)

# infra/bff-mobile

开发本组件的 AI 指南。用法、边界与契约：BRICKKIT.md；为什么这样设计：`docs/design.md`；依赖、配置与部署：component.yaml。

## 代码地图

| 路径 | 负责 |
|---|---|
| `src/main.ts` | 一行 `runStandalone(createModule)`：唯一可以碰进程的文件 |
| `src/module.ts` | 唯一入口 `createModule(rt)`：按已装的依赖裁 schema，用 `newGraphQLServer` 建 Yoga 服务 |
| `src/schema.ts` | 解析 `contracts/schema.graphql`，去掉缺席依赖的 `Query` / `Mutation` 字段 |
| `src/dependencies.ts` | 字段 → 依赖的登记表（`FIELD_TO_DEPENDENCY`），以及这次装配有哪些依赖 |
| `src/context.ts` | 每次请求的 context：调用者（config、`Authorization`、logger）与现造的 DataLoader |
| `src/persistedOperations.ts` | 启动时读一次持久化查询清单：配了 `PERSISTED_OPERATIONS_JSON` 用它，否则用镜像里的文件 |
| `src/clients/grpcProto.ts` | 运行期加载 vendor 的 `.proto`；`callUnary` 与 gRPC 状态 → GraphQL 错误的映射 |
| `src/clients/customer.ts` | mdm/customer 的 gRPC `BatchGet` |
| `src/clients/product.ts` | mdm/product 的 gRPC `BatchGet` 与 `List`（搜索） |
| `src/clients/restForward.ts` | 带调用者 `Authorization` 的 REST 转发；路径里的 id 用 `segment()`；HTTP 状态 → GraphQL 错误的映射 |
| `src/resolvers/` | 只放 resolver，每个下游一个文件，每个字段都包在 `requirePermission` 里；`index.ts` 汇总 |
| `contracts/schema.graphql` | 契约：裁剪之前的全量 schema |
| `contracts/persisted-operations.json` | 持久化查询清单（哈希 → 查询）；仓库里是空的 |
| `contracts/vendor/` | mdm/customer、mdm/product 的 `.proto` 只读拷贝；来源 tag 记在 `contracts/vendor/SOURCES.tsv` |
| `scripts/checkSchema.ts` | `make contract-check`：schema 合法，且相对某个 git 引用只增不改 |
| `test/harness.ts` | 把 `src/main.ts` 当真实子进程跑，下游是记录每个请求的 HTTP / gRPC 桩 |

| 功能 | 从这里开始 | 然后 |
|---|---|---|
| 新字段，读有数据范围的组件 | `contracts/schema.graphql` | `src/dependencies.ts`、`src/resolvers/` 里用 `forwardGet` 的 resolver、用 `startHttpStub` 的测试 |
| 新字段，读主数据 | `contracts/schema.graphql` | `src/clients/` 里的客户端函数、`src/dependencies.ts`、用 `startProductGrpcStub` 的测试 |
| 新的可选依赖 | `component.yaml`（经装配项目的清单 overrides） | `src/dependencies.ts`（`ALL_DEPENDENCIES`）、`test/schema.test.ts` |
| 下游拒绝时客户端看到的错误不对 | `src/clients/restForward.ts`（`VISIBLE_STATUS`） | `src/clients/grpcProto.ts`（`VISIBLE_GRPC_STATUS`）、`test/errors.test.ts`、`test/grpcErrors.test.ts` |
| 更新 vendor 的 `.proto` | `contracts/vendor/SOURCES.tsv` | 上游的发布 tag、`test/product.test.ts` |

## 构建与测试

```bash
npm ci
make test            # 类型检查 + vitest；下游是本机桩，不需要容器；"Tests  N passed | 12 skipped"
make check-version dag-check contract-check import-scan module-check   # 每个打印一行 ✓
make docs-check      # "0 with errors, 0 warnings"
```

跳过的用例要真实下游。`make test-e2e` 用真实用户 token 对在跑的组件跑 `test/e2e.test.ts`，该文件开头列的必填 `TEST_*` 变量（token、JWKS 与授权包地址、product / inventory / workflow 的地址）缺哪个就点名失败；可选的（notification、opportunity、customer、sales）给了就验，没给就验它们的字段不在 schema 里。`test/clients.test.ts` 的两条 gRPC 客户端用例读 `MDM_CUSTOMER_GRPC_ENDPOINT`、`MDM_PRODUCT_GRPC_ENDPOINT`、`TEST_CUSTOMER_ID`、`TEST_PRODUCT_ID`。`contract-check` 会打印它对比的 tag（`graphql breaking --against '<上一个发布 tag>'`）。真机上在项目根：`make verify ID=infra/bff-mobile FOCUS=1` 构建镜像、带着已装的依赖起来，最后收尾。

## 设计取舍

- **两条读路径，按数据来源有没有数据范围选**：主数据（`data_scopes: none`）走 gRPC + DataLoader；有数据范围的一律走 REST、带调用者的 token，因为只有 REST 层按调用者过滤。
- **schema 手写**，按移动端页面裁剪；不从各组件契约生成。
- **依赖缺席，字段就不存在**：字段从 schema 里去掉，绝不注册成返回 `null`。
- **写操作只做纯转发**：对一个组件调一次，客户端的幂等键原样透传。需要调两次的写操作属于业务组件。
- **下游拒绝保留原意**（`extensions.code`），记 warn；只有需要运维处理的失败才被掩盖并记成错误。

## 易错点

| 不要 | 症状 | 原因 |
|---|---|---|
| 用 gRPC 读有数据范围的组件（订单、库存、待办、通知、商机） | `order(id: "<别人的>")` 照样返回；测试全绿 | 组件之间的 gRPC 不按调用者过滤；只有 REST 层套数据范围 |
| 往 schema 加字段却不在 `FIELD_TO_DEPENDENCY` 登记 | 对应组件没装时字段仍在 schema 里；App 查它永远拿到 `null`，页面空白不报错 | `src/schema.ts` 只裁登记过的字段；`test/resolvers.test.ts` 核对两张表一致 |
| 在模块顶层建 DataLoader | 一个用户缓存的行答了另一个用户的请求；单请求测试永远看不出来 | DataLoader 在 `src/context.ts` 里每次请求现造 |
| 把 id 拼进路径时不经 `segment()` | `order(id: "7?view=all")` 把 `?view=all` 当查询参数发给 `erp/sales`；`../` 改写路径 | id 来自客户端；`encodeURIComponent` 让它始终是一段路径 |
| 下游 `4xx` 或调用者错误类的 gRPC 状态抛普通 `Error` | 客户端看到 `INTERNAL_SERVER_ERROR`，分不出"重新登录"和"服务挂了"；Yoga 记成 ERROR | 经 `VISIBLE_STATUS` / `VISIBLE_GRPC_STATUS` 映射成 `GraphQLError` |
| 从上游的工作区拷 vendor 的 `.proto` | 发布前字段号可能还会变；BFF 解码的消息与上游发的不是同一个 | 只从上游的发布 tag 取，并在 `contracts/vendor/SOURCES.tsv` 记下 tag |
| 照 `.proto` 猜字段名 | `proto-loader` 把 `next_cursor` 变成 `nextCursor`，枚举返回 `PRODUCT_STATUS_ACTIVE` | `keepCase: false`、`enums: String`；前缀用 `stripEnumPrefix` 剥掉 |
| 用仓库里的空清单构建镜像、指望查询能用 | 每个查询都以 `PersistedQueryOnly` 拒绝（HTTP `400`）；`/healthz` 是绿的 | 只认清单里的哈希；清单由移动端 App 的构建提供，放进镜像或经 `PERSISTED_OPERATIONS_JSON` 给出 |
| 以为 `PERSISTED_OPERATIONS_JSON` 是在镜像清单上追加 | 只在镜像清单里的查询回 `PersistedQueryNotFound` | 它整份替换镜像里的清单；合并出来的清单没有人审过 |

## 改代码前自查

1. 字段的数据来源组件有没有行级数据范围？有就走 REST（`forwardGet` / `forwardPost`），绝不走 gRPC。
2. 新字段在 `src/dependencies.ts` 登记了吗？包在 `requirePermission` 里、用的是 `assembly.yaml` 里的键吗？
3. 改契约？只增不改：新字段、新类型、可选参数。`make contract-check` 对比上一个发布 tag。
4. 新写操作：是不是对一个组件调一次？调两次就是编排，属于业务组件。
5. 新加的每种下游拒绝，是否以 `extensions.code` 到达客户端、记 warn 而不是 error？
6. 新行为先写失败的测试，用 `test/harness.ts` 的桩。
7. 发布后第一次改动之前先升 `metadata.version`（和 `package.json`）；BRICKKIT.md 与 `docs/design.md` 与代码同一个提交更新。
