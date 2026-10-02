# infra/bff-mobile

## Purpose

The GraphQL backend-for-frontend of the mobile app: one query fills one mobile page, assembled from the components that hold the data. It has no business logic and no database; whatever it shows, another component owns and decides.

**Owns**

- The mobile GraphQL schema, written by hand and cut to the mobile pages (`contracts/schema.graphql`), and its single endpoint `POST /graphql`.
- Cutting that schema to the assembly: a field whose component is not installed is not in the schema at all.
- Batched reads (one gRPC `BatchGet` per request for the customers or products of a page) and the query limits: depth 5, cost 100, persisted queries only.
- One permission key per field group (`infra.bff-mobile.*`), checked before any downstream call.

**Does not own**

- Any business rule, including small ones ("can this order be cancelled" is `erp/sales`'s answer): the component that owns the data.
- Who may see which rows: each downstream component's REST layer applies its own data scopes to the caller's token, which this component forwards unchanged.
- Approval logic, notification delivery, stock, orders, opportunities, master data: `infra/workflow`, `infra/notification`, `erp/inventory`, `erp/sales`, `crm/opportunity`, `mdm/customer`, `mdm/product`.
- The list of queries the mobile app may send (the persisted-operation manifest): produced by the mobile app's build, shipped inside this component's image or supplied at deploy time through `PERSISTED_OPERATIONS_JSON`.
- PC pages and printing: the PC frontend calls components through the gateway; printing is `infra/print`.

## Before you deploy

- **No database, no NATS, no object storage.** Nothing to create.
- **Authorization** (`infra/authz`) and **identity** (`infra/iam-casdoor`, or any IAM serving a JWKS) reachable at `AUTHZ_BUNDLE_URL` and `IAM_JWKS_URL` for any field to answer anything but errors. They are configuration, not dependencies: the component starts without them.
- **The persisted-operation manifest** (hash → query text) must contain the mobile app's queries. Either build it into the image as `contracts/persisted-operations.json`, or supply it at deploy time with `PERSISTED_OPERATIONS_JSON: file://<manifest file>`, which replaces the built-in one. The repository holds an empty manifest, so with neither every query is rejected. Release the manifest together with the mobile app.
- **The gateway** routes `/graphql` to this component (edge route in `assembly.yaml`).

## Dependencies

All optional. A missing one never stops the component from starting: its fields are simply not in the schema (introspection does not show them, and a query naming them fails validation).

| Dependency | Used for | Fields that disappear without it |
|---|---|---|
| `mdm/customer` | gRPC `BatchGet` of customers | `customer`, `customers` |
| `mdm/product` | gRPC `BatchGet` of products; gRPC `List` with `q` for search | `product`, `products`, `searchProducts` |
| `erp/sales` | REST `GET /orders/{id}`, `GET /orders` | `order`, `myOrders` |
| `erp/inventory` | REST `GET /balances`, `GET /balances/list`, `GET /warehouses` | `inventoryBalance`, `inventoryBalances`, `warehouses` |
| `infra/workflow` | REST `GET /tasks`, `GET /tasks/{id}`, `POST /tasks/{id}/approve`, `POST /tasks/{id}/reject` | `myTasks`, `task`, `approveTask`, `rejectTask` (and the whole `Mutation` type) |
| `infra/notification` | REST `GET /notifications` | `myNotifications` |
| `crm/opportunity` | REST `GET /opportunities?view=mine`, `GET /opportunities/{id}` | `myOpportunities`, `opportunity` |

Master data (`data_scopes: none`) is read over gRPC. Everything with row-level scopes is read over REST with the caller's `Authorization` header forwarded unchanged, because only the REST layers apply data scopes; gRPC between components does not filter by caller.

The authorization bundle and the JWKS are fetched from the URLs in the configuration, not through a dependency edge. Without them every field fails closed: no or invalid token → `401`; `IAM_JWKS_URL` empty → `403`; the JWKS unreachable → `401` (the token cannot be verified); the bundle never fetched yet → `503`; a valid user without the field's permission key → `403`. `/healthz` stays `200` throughout: it reports only that this process is alive.

## Configuration

| Variable | Meaning |
|---|---|
| `AUTHZ_BUNDLE_URL` | URL of the authorization bundle the permission check polls, for example `http://infra-authz-2-0-0:8223/authz/bundle`. Required: without it every field answers `503`. Keep it in step with the authz version the project runs. |
| `IAM_JWKS_URL` | URL of the JWKS used to verify user tokens locally, for example `http://infra-iam-casdoor-2-0-0:8200/.well-known/jwks.json`. Required: without it every field answers `403`. |
| `OTEL_BASE_URL` | OpenTelemetry collector base URL; empty (the default) exports nothing. |
| `PERSISTED_OPERATIONS_JSON` | The persisted-operation manifest as a JSON object (hash → query text), usually written `file://<manifest file>` so that the platform injects the file's content. Empty (the default) uses the manifest built into the image. When set, it replaces that manifest entirely (no merge); a value that is not a JSON object of strings stops the component at start. It changes which queries are allowed, never whether only listed queries are allowed. |

Dependency addresses are injected by the platform (`<ID>_ENDPOINT`, and `<ID>_GRPC_ENDPOINT` for the gRPC ports of `mdm/customer` and `mdm/product`); there is nothing to configure for them.

## Contracts

- `contracts/schema.graphql` — the GraphQL schema, at `POST /graphql`. Queries: `customer`, `customers` (`infra.bff-mobile.customer.view`); `product`, `products`, `searchProducts` (`infra.bff-mobile.product.view`); `order`, `myOrders` (`infra.bff-mobile.order.view`); `inventoryBalance`, `inventoryBalances`, `warehouses` (`infra.bff-mobile.inventory.view`); `myTasks`, `task` (`infra.bff-mobile.task.view`); `myNotifications` (`infra.bff-mobile.notification.view`); `myOpportunities`, `opportunity` (`infra.bff-mobile.opportunity.view`). Mutations: `approveTask`, `rejectTask` (`infra.bff-mobile.task.act`), each with an optional client-generated `idempotencyKey`, forwarded unchanged when given and left out when not (workflow dedups by task state, not by the key). Lists page by cursor (`cursor`, `pageSize`, `nextCursor`); amounts and quantities are decimal strings. A downstream refusal appears as a field error whose `extensions.code` is `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` or `BAD_USER_INPUT`; any other failure as the generic `Unexpected error.`. Only queries in the persisted-operation manifest are accepted (Apollo APQ form, `extensions.persistedQuery.sha256Hash`).
- `assembly.yaml` — this project's metadata: the eight permission keys above, the edge route `/graphql`, and `data_scopes: none`.
- `contracts/vendor/` — read-only copies of the `.proto` files of `mdm/customer` and `mdm/product`, taken from their release tags; not this component's contract.
- Events: none published, none consumed.

## Shell declaration

Not a shell, and never hosted in one: the shells are Go and Python processes, and a TypeScript module cannot join them. It always runs as its own container.
