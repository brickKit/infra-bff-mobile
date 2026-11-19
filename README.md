# infra-bff-mobile

组件 `infra/bff-mobile`（移动端展示聚合）的仓库：移动入口的只读 GraphQL，一次查询供一个移动页面，每块数据经它的属主组件的用户面、以调用者自己的凭据取来；只认部署登记的持久化查询。用法与部署在 `BRICKKIT.md`，设计在 `docs/design.md`，代码地图在 `AGENTS.md`。

旧版本（2.x（TypeScript））在分支 `legacy/v2`，标签保留；本主分支按终局设计从零开始（D59），版本从 `3.0.0` 起（A110）。设计依据：装配项目 [be-assembly-standard](https://github.com/brickKit/be-assembly-standard) 的边界卡 `docs/zh/07-components/infra.md`（`infra/bff-mobile` 一节）与协议 20。

## 在项目里使用

在装配项目里 `brickkit add infra/bff-mobile@<版本>`，再按 `BRICKKIT.md` 的“部署前准备”配置（持久化查询清单由移动入口的构建产出）。

## 文档

| 问题 | 看哪里 |
| --- | --- |
| 它做什么、怎样部署与配置 | `BRICKKIT.md` |
| 为什么这样设计：术语、规则、取舍、未决问题 | `docs/design.md` |
| 怎样改它 | `AGENTS.md` |
| 契约 | `contract/README.md` |

## 开发

见 `AGENTS.md` 的“构建与测试”。
