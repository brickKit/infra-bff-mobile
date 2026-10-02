[English](README.md) · [中文](README.zh.md)

# infra/bff-mobile

移动端 App 的 GraphQL 聚合层（BFF）；按页面裁剪的 schema、批量加载，没有业务逻辑，也没有数据库。

## 在项目里使用

```bash
brickkit add infra/bff-mobile@2.0.0
brickkit up
```

先看 BRICKKIT.zh.md 的"部署前准备"（授权包与 JWKS 的 URL，以及镜像里要装着移动端 App 的持久化查询清单）。依赖全部可选：移动端要展示哪些组件的数据，就加哪些组件。

## 文档

| 想知道 | 读 |
|---|---|
| 它做什么、不做什么，怎么配置，要准备什么 | [BRICKKIT.zh.md](BRICKKIT.zh.md) |
| 全部 query 与 mutation 及其参数 | [contracts/schema.graphql](contracts/schema.graphql) |
| 为什么这样设计：两条读路径、schema 裁剪、写操作、未决问题 | [docs/design.zh.md](docs/design.zh.md) |
| 依赖什么（全部可选）、有哪些配置键 | [component.yaml](component.yaml) |
| 怎么开发：代码地图、测试、易错点 | [AGENTS.zh.md](AGENTS.zh.md) |

## 开发

TypeScript（Node 24），经 be-sdk-ts 用 GraphQL Yoga，`@grpc/grpc-js` + `@grpc/proto-loader`，vitest。`npm ci && make test` 不需要任何容器：测试把真实服务跑起来、对着本机桩。确切命令与成功的样子见 AGENTS.zh.md 的"构建与测试"。在 BrickEnterprise 项目里，项目根的 `make verify ID=infra/bff-mobile FOCUS=1` 真机跑一遍并收尾。
