[English](design.md) · [中文](design.zh.md)

# infra/bff-mobile design

Conclusions only, for whoever changes this component's design. How to use it: `BRICKKIT.md`; how the code is laid out: `AGENTS.md`.

## Boundaries

This component is the mobile app's aggregation layer: one GraphQL query fills one mobile page, assembled from the components that own the data. Three jobs, nothing else: aggregation for display, batched reads against N+1 (DataLoader over `BatchGet`), and a schema cut to what this assembly installed.

| Not here | Owner | Why |
|---|---|---|
| Any business rule, however small ("can this order be cancelled") | the component owning the data | This layer sits between the frontend and the backend; a rule here is a rule in the frontend |
| Any database, cache table or persisted state | the business components | Caching needs invalidation, invalidation needs business meaning; a process-local, short-lived cache is the most this component may ever hold |
| Deciding who may see which rows | each downstream's REST layer | The caller's token is forwarded unchanged; this component is not a security boundary for data |
| Orchestrating writes (call A, then B) | the business component | A write here is one forwarded call; anything more is orchestration with idempotency, timeouts and compensation, which live in the business component |
| PC pages, printing | the PC frontend through the gateway; `infra/print` | Different clients, different shapes |

It is a backend component (`tier: backend`): a server container, not something delivered to the browser.

## Owned data

None: no tables, no schema, no login role. The only state is in the process and disappears on restart: the DataLoader batches of one request, and the authorization bundle held by the SDK.

| Tempting table | Why not |
|---|---|
| Query result cache | Invalidation needs business meaning (see Boundaries) |
| Persisted-query registry | The manifest is a build artefact, read only at run time; a writable registry lets anyone register any query |
| User preferences, recently viewed | Business data of some other component |

## Contract surface

GraphQL over HTTP, one endpoint `POST /graphql`, plus `/healthz`. No gRPC served; it is only a gRPC client.

**The schema is written by hand** (`contracts/schema.graphql`), cut to mobile pages, not generated from the components' contracts: a mechanical union of every contract would leave the frontend to assemble pages itself, which removes the reason the BFF exists. The cost is that a downstream contract change does not reach the schema by itself; the mapping code and its tests are where it is kept in step.

**Cut to the assembly.** At start the component checks which optional dependencies have an injected address and removes the `Query` / `Mutation` fields of the others (`FIELD_TO_DEPENDENCY`); when no mutation is left the `Mutation` type disappears. A field is never kept to return `null`: introspection would advertise it and the page would be blank without an error. This is one half of what the frontend sees; the menu side (installed features) must be driven by the same assembly.

**Two read paths, by the source's data scopes:**

| Source | Path | Why |
|---|---|---|
| `mdm/customer`, `mdm/product` (`data_scopes: none`) | gRPC `BatchGet` through a per-request DataLoader; product search through gRPC `List` with `q` | Master data is visible to all; batching one page's IDs into one call is the point |
| `erp/sales`, `erp/inventory`, `infra/workflow`, `infra/notification`, `crm/opportunity` (owner / org / warehouse scopes) | REST, the caller's `Authorization` forwarded unchanged | Component-to-component gRPC does not filter by caller; only REST layers apply data scopes, so gRPC here would hand out anyone's rows |

`inventoryBalance`, `order`, `task` and `opportunity` read one row by known IDs, so they have no DataLoader. `inventoryBalances` reads `GET /balances/list` (one product across the caller's warehouses); `GET /balances` keeps its single-row meaning. `myOpportunities` always sends `view=mine`: the mobile page shows the caller's own opportunities; the department view is a PC page.

**Writes**: `approveTask` and `rejectTask`, each one forwarded `POST` to `infra/workflow`, answering the task detail after the change. `idempotencyKey` is optional: when the client sends one (one per user action, repeated on retry) it is forwarded as `idempotency_key`; when it doesn't, the field is left out. Dedup does not rest on it, because workflow's REST layer dedups by state: a task leaves `PENDING` once, so a retry after a success answers `CONFLICT` ("already handled, refresh"), never a second approval. The rule for any future mutation: one call to one component; two calls is orchestration and goes back to the business component.

**Limits** (fixed in the SDK): depth 5, cost 100, persisted queries only. The manifest (hash → query text, Apollo APQ form) is produced by the mobile app's build and either shipped in this component's image or supplied at deploy time through `PERSISTED_OPERATIONS_JSON` (usually `file://`), which replaces the built-in manifest entirely; merging two manifests would yield a list nobody reviewed. The repository's manifest is empty, so a fresh build with nothing configured rejects every query. A configured value that is not a JSON object of strings stops the component at start rather than letting it run with an empty list. The frontend and its manifest are released together.

**Errors**: a downstream refusal the caller can act on keeps its meaning as `extensions.code`, from REST (`400` / `401` / `403` / `404` / `409`) and from gRPC alike (`INVALID_ARGUMENT` / `FAILED_PRECONDITION` / `OUT_OF_RANGE` → `BAD_USER_INPUT`, `UNAUTHENTICATED`, `PERMISSION_DENIED` → `FORBIDDEN`, `NOT_FOUND`, `ALREADY_EXISTS` / `ABORTED` → `CONFLICT`: the same pairs the Go SDK maps to HTTP), and is logged at warn with dependency, path or method, and status. Anything else (`5xx`, `UNAVAILABLE`, a refused connection) is masked as `Unexpected error.` and logged as an error: only those need an operator. A read that answers `404` is `null`; a write that answers `404` is a `NOT_FOUND` error, because the client must know the action did not happen.

**Permissions**: one key per field group, `requirePermission(key, resolver)` on every root field; the resolver directory holds nothing else, so the bare-resolver scan (`make module-check`, `make gates`) and `test/resolvers.test.ts` can check it.

## Events

None published, none consumed, and no NATS connection. Events change state somewhere, and this component holds none; a read-only aggregation layer that consumes events is usually caching something it should not.

## Dependencies

All optional (`optional: true`), because the component must start in any assembly: a required dependency would mean "no mobile app without that component".

| Dependency | Used for |
|---|---|
| `mdm/customer` | customers by ID (gRPC `BatchGet`) |
| `mdm/product` | products by ID (gRPC `BatchGet`), product search (gRPC `List` with `q`) |
| `erp/sales` | one order, my orders (REST) |
| `erp/inventory` | one balance, balances of a product, warehouses (REST) |
| `infra/workflow` | my tasks, task detail, approve, reject (REST) |
| `infra/notification` | my notifications (REST) |
| `crm/opportunity` | my opportunities, one opportunity (REST) |

| Not a dependency | Why |
|---|---|
| any database, NATS | no owned data, no events |
| `infra/iam-casdoor` | tokens are verified locally against the JWKS at `IAM_JWKS_URL`: configuration, not an edge; an edge would also tie the app to one IAM |
| `infra/authz` | the permission bundle is polled from `AUTHZ_BUNDLE_URL`; the check is an in-process lookup |
| `infra/print` | printing is the business components' and the frontend's business, through the gateway |

The `.proto` files of the two gRPC sources are vendored read-only from their release tags (`contracts/vendor/SOURCES.tsv`) and loaded at run time by `@grpc/proto-loader`; no generated code, no other component's code is imported.

## Place in the synchronous call graph

A root: seven outgoing edges, all optional, and no incoming component edge (only the mobile app, through the gateway, calls it). Its targets are the leaf hubs (`mdm/*`, `erp/inventory`, `infra/workflow`, `infra/notification`) and `erp/sales` / `crm/opportunity`, whose own edges point at leaves, so it can never be on a cycle. Reading both CRM and ERP does not break "no synchronous edge between CRM and ERP": that rule binds business components; aggregating across domains for display is exactly the BFF's job.

## Partitioning and archiving

Not applicable: no persistent data.

## Data scopes

None of its own (`data_scopes: none`), which does not mean "unfiltered": every scoped field is answered by the downstream's REST layer under the caller's token, so the caller sees exactly what the PC pages would show them. Master data has no scopes anywhere.

## Reference implementations

| Project | Version | Module consulted | What was borrowed | License | Usage |
|---|---|---|---|---|---|
| GraphQL Yoga | 5.22.0 (through be-sdk-ts) | persisted operations plugin | build-time safelist that rejects unknown hashes (not run-time registration) | MIT | Borrowed reasoning |
| graphql-armor | 3.2.0 (through be-sdk-ts) | depth and cost limits | ready-made limits instead of writing them | MIT | Borrowed reasoning |
| DataLoader | 2.2.3 | batching and per-request caching | one loader per request | MIT | Borrowed reasoning |
| BFF pattern (Netflix, SoundCloud write-ups) | — | one backend per frontend | a BFF is cut to its frontend: supports the hand-written schema | articles | Borrowed practice |

**Deliberately avoided**: federated gateways (Apollo Federation, GraphQL Mesh), which compose many teams' subgraphs automatically and bring back the mechanical union; a Redis cache in the BFF (invalidation needs business meaning, and the project has no Redis); a global DataLoader (one user's rows served to another); reading databases directly to save a hop (it would depend on every component's tables).

No slot family: GraphQL versus REST aggregation is a one-time technology choice coupled to the frontend's query code, not a difference between customers.

## Open questions

| Question | Current answer |
|---|---|
| Who produces the persisted-operation manifest, and how are the app and this component versioned together? | The mobile app's build produces it; it is copied into this image or supplied through `PERSISTED_OPERATIONS_JSON` at deploy time. The release coupling is to be written into the deployment procedure when the mobile app exists |
| Is one large query per page faster on a weak network than several small ones? | To be measured; the criterion is first-screen time end to end, not the number of requests |
| `infra/workflow`'s REST approve / reject ignores the forwarded `idempotency_key` and dedups by state (retry after success → `CONFLICT`) | Safe (never approved twice); if the app needs the first result replayed instead of `CONFLICT`, workflow's REST layer would have to accept the key |
| A downstream contract change does not reach the hand-written schema or the vendored `.proto` by itself | Kept in step by the mapping tests against stubs and the end-to-end run against real downstreams; an automatic comparison against the upstream contracts is not built |
| Yoga's own error log (masked failures) is plain text, not the SDK's JSON log | Accepted for now; the SDK owns the server and would have to route it |
