# infra/bff-mobile

## 组件定位

移动入口的只读展示聚合：一次 GraphQL 查询供一个移动页面，数据从拥有它的组件取来、按页面的形状拼好。
- **读路径**：每个字段经属主组件的**用户面**取，转发调用者自己的凭据；谁能看哪些行、哪些字段由属主判断，本组件不是数据的安全边界。“我的订单”“我的商机”按已核验的调用者筛选。
- **只认持久化查询**：请求只带查询的 SHA-256，查询文本来自部署配置的清单（移动入口构建时产出）；清单里不合 schema 或超出上限（深度 6、代价 200、别名 10、每页至多 50）的条目在启动时逐条拒绝并告警，其余照常。
- **缺件**：一个属主慢了或拒绝，只有它那部分为空，GraphQL 的错误带 `reason`、`domain`、`metadata.dependency`、`trace_id`（可重试的另带 `retry_after`）；没装的属主组件，它的字段不在本部署的 schema 里。
- **只读**：审批的决定、通知的已读这类写操作，移动端经边缘直接发给属主（待办条目里的动作入口）。

**3.0.0**（第一个重建的版本）：我的待办与任务详情（`infra/workflow`）、我的通知（`infra/notification`）、产品搜索与详情（`mdm/product`）及各仓库的可用量（`erp/inventory`）、客户（`mdm/partner`）、我的销售订单（`erp/sales`）、我的商机（`crm/opportunity`）。

## 部署前准备

- 没有数据库、不连消息系统、没有系统面。
- **持久化查询清单** `BFF_PERSISTED_QUERIES`：JSON 对象，键是查询文本的 SHA-256（小写十六进制），值是查询文本；在本组件的配置里写 `file://<路径>`（BrickKit 把文件内容交给组件），清单由移动入口的构建产出，构建时用本组件的 `check-manifest <文件>` 校验（有任何一条不合就失败）。不配时拒绝一切查询。清单作为一个环境变量传入，单个变量的上限约 128 KiB（Linux），清单接近它时见设计的未决问题。
- 授权：`infra.bff_mobile.entry.use`（资源 `infra.bff_mobile.entry`，没有维度）授予用移动入口的人；他们在各属主组件上原有的授权决定能看到什么。
- 入口：首批只支持浏览器入口（移动 H5），经边缘的会话；边缘按前缀 `/api/bff-mobile/` 路由，客户端每个请求带 `BE-Request: 1`，只为刷新的轮询另带 `BE-Polling: 1`。
- 部署的服务证书（`SERVICE_TLS_*`）；身份与授权（`IAM_*`、`AUTHZ_GRPC_URL`、`DEPLOYMENT_ID`）。
- 无状态、低负载：默认单跑，可以进外壳（`be/go-infra`）。

## 依赖说明

- 必需：身份成员、授权成员（经配置引用）。
- 可选（全部被聚合的组件）：`infra/workflow`、`infra/notification`、`mdm/product`、`erp/inventory`、`mdm/partner`、`erp/sales`、`crm/opportunity`。没装的，它的字段不注册，用到它们的持久化查询在启动时被拒绝。
- 属主不可达：只有它的字段为空并标明，其余照常返回。

## 配置指南

全部键见 `component.yaml` 的 `configSchema`（由 SDK 生成，测试核对）。

| 键 | 说明 |
| --- | --- |
| `BFF_PERSISTED_QUERIES`（密钥类型） | 持久化查询清单（见部署前准备）；写 `file://<路径>`；BrickKit 之外运行时可改设 `BFF_PERSISTED_QUERIES_FILE` 为文件路径 |
| `DEPLOYMENT_ID`、`IAM_ISSUER`、`IAM_JWKS_URL`、`AUTHZ_GRPC_URL`、`SERVICE_TLS_CERT_FILE`、`SERVICE_TLS_KEY_FILE`、`SERVICE_TLS_CA_FILE` | 受保护的用户面要用；在外壳里是进程级的键 |

被聚合组件的地址由 BrickKit 按依赖注入（`<ID>_ENDPOINT`），不用配置。

## 契约索引

- **用户面**：`contract/openapi.yaml`，一条路由 `POST /api/bff-mobile/graphql`（要 `infra.bff_mobile.entry.use`）；schema 是 `contract/schema.graphql`。入口自己的拒绝：401（未认证）、403 `PERMISSION_DENIED`、400 `REQUEST_INVALID`（请求体、变量、`limit` 超出 1–50）、400 `PERSISTED_QUERY_NOT_FOUND`（domain `infra/bff-mobile`）。
- **系统面**：没有。
- **事件**：不发布、不订阅。

## 外壳声明

不是外壳。可以被 Go 的基础外壳（`be/go-infra`）承载。
