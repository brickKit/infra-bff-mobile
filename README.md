# infra-bff-mobile · 移动端聚合层

全系统第一个 TypeScript 组件。GraphQL BFF：手写 schema（不是从 62 个组件的 proto 机械并集出来的），按前端页面裁剪，一个查询喂满一个页面。严禁业务逻辑与直连数据库（设计书 §6.5 两条铁律）。

## 它能做什么

- 单一端点 `POST /graphql`：手写 schema 覆盖 5 个弱依赖组件的读接口——客户（`mdm/customer`）、产品（`mdm/product`）、订单（`erp/sales`）、库存余量（`erp/inventory`）、我的待办（`infra/workflow`，移动端主场景）
- **两类读走两条不同的路径**：`data_scopes: none` 的组件（客户/产品）走 gRPC `BatchGet` + DataLoader 防 N+1；有真实 org/owner/warehouse 数据权限的组件（订单/库存/待办）改走 REST 转发 `Authorization` 头，让下游各自的 REST 面去判权限——全项目的 gRPC 组件间协议统一不做数据权限过滤，照搬 gRPC BatchGet 的模式会绕开数据权限
- **按装配裁剪**：这个环境没装的组件，对应字段在构建 schema 时根本不注册，不是"注册了返回 null"
- 三条硬限制全部强制（§11.4.3）：`max_depth: 5`、`max_complexity: 100`、`persisted_queries_only: true`（构建期产物 `contracts/persisted-operations.json`，随镜像发布，运行时只读）

⚠️ **没有 mutation**——本阶段只做 query。写操作往往是 TCC/补偿链的入口，代理写操作就是在做业务编排，违反铁律一；前端写操作直接走网关到业务组件的 REST。

## 需要哪些基础资源

**无。** `component.yaml` 的 `dependencies.resources` 是空的——全系统罕见。本组件零数据库（§6.5 铁律二）、零 NATS（不持有任何状态就不需要发/收事件）。

五个弱依赖组件（`mdm/customer`、`mdm/product`、`erp/sales`、`erp/inventory`、`infra/workflow`）全部 `optional: true`——一条强依赖都不能有，客户只买了一部分组件时本组件也要能起来。

## 怎么起来

```bash
npm install
npm run build

COMPONENT_ID=infra/bff-mobile COMPONENT_VERSION=1.0.0 \
  MDM_CUSTOMER_ENDPOINT=http://<容器IP>:9090 \
  INFRA_WORKFLOW_ENDPOINT=http://<容器IP>:8201 \
  IAM_JWKS_URL=http://<infra-iam-casdoor>/.well-known/jwks.json \
  AUTHZ_BUNDLE_URL=http://<infra-authz>/authz/bundle \
  node dist/main.js
```

或者用平台：`brickkit up`。

## 怎么用

```bash
# 前端真实用法：Persisted Operations——发哈希，不发裸查询文本
curl -X POST http://localhost:8500/graphql \
  -H 'Authorization: Bearer <应用 token>' -H 'Content-Type: application/json' \
  -d '{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"<构建期算好的哈希>"}}}'
```

`persisted_queries_only: true`（§11.4.3 强制）——直接发裸 `query` 字符串会被拒绝（`PersistedQueryOnly` 错误），这是刻意的：弱网下每次传完整查询文本成本高，而且允许客户端发任意查询本身就是攻击面。`contracts/persisted-operations.json` 是构建期产物（哈希→查询文本），前端构建时生成、随本组件镜像一起发布；本仓库当前只有一份空清单（`{}`）——`frontend-standard`（阶段三 Task 12）建成之前，这个限制天然拒绝一切非 introspection 查询，这是 fail-closed 的正确默认值，不是漏配置。

## 配置项

| 配置键 | 默认值 | 说明 |
|---|---|---|
| `otelBaseUrl` | `""` | 空 = Blackhole Exporter，零成本 |
| `iamJwksUrl` | `""` | JWT 本地验签的公钥来源，指向 `infra-iam-casdoor` |
| `authzBundleUrl` | `""` | 权限判定的 bundle 轮询地址，指向 `infra-authz` |

## 参考实现

| 项目 | 看的模块 | 借鉴了什么 | 许可证 | 用法 |
|---|---|---|---|---|
| GraphQL Yoga | Persisted Operations 插件、depth/complexity 插件 | 内置 Persisted Operations 插件明确支持"构建期注册表 + 拒绝未知哈希"这种 safelisting 形态 | MIT | 借鉴逻辑 |
| `graphql-armor` | depth / complexity 防护插件 | 现成的组合包，不用自己写 | MIT | 借鉴逻辑 |
| DataLoader | 批处理与 per-request 缓存的用法约定 | "必须 per-request"的出处——它的 README 自己就强调这一点 | MIT | 借鉴逻辑 |
| Netflix / SoundCloud 的 BFF 实践 | BFF 模式的原始定义 | "BFF 要按前端裁剪"是这个模式的题中之义 | 闭源/文章 | 借鉴实际应用 |

完整调研过程见 [`docs/design/infra-bff-mobile.md`](../../../docs/design/infra-bff-mobile.md)。

## 边界与禁令

- **严禁任何业务逻辑**——包括看起来无害的："这张单能不能取消"要问 `erp-sales`，不许按 `status` 字段自己判
- **严禁直连数据库**——一张表都没有，连 `event_outbox` 都没有
- **不做鉴权判定本身**——本组件透传 JWT，下游各自判；`requirePermission` 只挡"这个字段谁能查"，不是数据权限
- **DataLoader 必须是 per-request 实例**——做成全局单例的症状是 A 用户看到 B 用户的数据，而且单请求测试永远测不出来
- **有真实数据权限的字段走 REST，不走 gRPC**——全项目的 gRPC 组件间协议不做数据权限过滤，照搬 `data_scopes: none` 组件的 gRPC BatchGet 模式会绕开数据权限（见 `contracts/schema.graphql` 顶部注释）
- **不进任何外壳**（设计书 §13.5：跨语言合不进来），合并部署时保持独立容器
