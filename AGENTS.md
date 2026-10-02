[English](AGENTS.md) · [中文](AGENTS.zh.md)

# infra/bff-mobile

The AI guide to developing this component. How to use it, its boundaries and contracts: BRICKKIT.md. Why it is shaped this way: `docs/design.md`. Dependencies, configuration and deployment: component.yaml.

## Code map

| Path | Owns |
|---|---|
| `src/main.ts` | One line, `runStandalone(createModule)`: the only file that may touch the process |
| `src/module.ts` | The only entry, `createModule(rt)`: cuts the schema to the installed dependencies and builds the Yoga server with `newGraphQLServer` |
| `src/schema.ts` | Parses `contracts/schema.graphql` and drops the `Query` / `Mutation` fields of absent dependencies |
| `src/dependencies.ts` | Field → dependency table (`FIELD_TO_DEPENDENCY`) and which dependencies this assembly has |
| `src/context.ts` | Per-request context: the caller (config, `Authorization`, logger) and fresh DataLoaders |
| `src/persistedOperations.ts` | Reads the persisted-operation manifest once at start: `PERSISTED_OPERATIONS_JSON` when set, otherwise the file in the image |
| `src/clients/grpcProto.ts` | Loads the vendored `.proto` at run time; `callUnary` and the gRPC status → GraphQL error mapping |
| `src/clients/customer.ts` | gRPC `BatchGet` of mdm/customer |
| `src/clients/product.ts` | gRPC `BatchGet` and `List` (search) of mdm/product |
| `src/clients/restForward.ts` | REST forwarding with the caller's `Authorization`; `segment()` for IDs in paths; HTTP status → GraphQL error mapping |
| `src/resolvers/` | Resolvers only, one file per downstream, every field wrapped in `requirePermission`; `index.ts` collects them |
| `contracts/schema.graphql` | The contract: the full schema, before cutting |
| `contracts/persisted-operations.json` | The persisted-operation manifest (hash → query); empty in the repository |
| `contracts/vendor/` | Read-only `.proto` copies of mdm/customer and mdm/product; their source tags in `contracts/vendor/SOURCES.tsv` |
| `scripts/checkSchema.ts` | `make contract-check`: schema valid, and append-only against a git reference |
| `test/harness.ts` | Runs `src/main.ts` as a real child process against HTTP and gRPC stubs that record every request |

| Feature | Start here | Then |
|---|---|---|
| A new field reading a scoped component | `contracts/schema.graphql` | `src/dependencies.ts`, a resolver in `src/resolvers/` using `forwardGet`, a test with `startHttpStub` |
| A new field reading master data | `contracts/schema.graphql` | a client function in `src/clients/`, `src/dependencies.ts`, a test with `startProductGrpcStub` |
| A new optional dependency | `component.yaml` (through the manifest overrides of the assembly project) | `src/dependencies.ts` (`ALL_DEPENDENCIES`), `test/schema.test.ts` |
| A downstream refusal shows the wrong error | `src/clients/restForward.ts` (`VISIBLE_STATUS`) | `src/clients/grpcProto.ts` (`VISIBLE_GRPC_STATUS`), `test/errors.test.ts`, `test/grpcErrors.test.ts` |
| Updating a vendored `.proto` | `contracts/vendor/SOURCES.tsv` | the upstream's release tag, `test/product.test.ts` |

## Build and test

```bash
npm ci
make test            # typecheck + vitest; downstreams are local stubs, no container needed; "Tests  N passed | 12 skipped"
make check-version dag-check contract-check import-scan module-check   # each prints a ✓ line
make docs-check      # "0 with errors, 0 warnings"
```

The skipped tests need real downstreams. `make test-e2e` runs `test/e2e.test.ts` against running components with a real user token, and fails, naming the variable, when one of the required `TEST_*` variables listed at the top of that file is not set (a token, the JWKS and bundle URLs, and the product, inventory and workflow addresses); the optional ones (notification, opportunity, customer, sales) are checked when given and checked absent from the schema when not. The two gRPC client tests in `test/clients.test.ts` read `MDM_CUSTOMER_GRPC_ENDPOINT`, `MDM_PRODUCT_GRPC_ENDPOINT`, `TEST_CUSTOMER_ID` and `TEST_PRODUCT_ID`. `contract-check` prints the tag it compares against (`graphql breaking --against '<last release tag>'`). On a real machine, from the project root: `make verify ID=infra/bff-mobile FOCUS=1` builds the image, starts it with the installed dependencies and tears down.

## Design decisions

- **Two read paths, chosen by the source's data scopes**: master data (`data_scopes: none`) over gRPC with DataLoader; everything scoped over REST with the caller's token, because only REST layers filter by caller.
- **The schema is written by hand**, cut to mobile pages; not generated from the components' contracts.
- **Absent dependency, absent field**: fields are removed from the schema, never registered to return `null`.
- **Writes are pure forwarding**: one call to one component, the client's idempotency key passed through. A write that needs two calls belongs in a business component.
- **Downstream refusals keep their meaning** (`extensions.code`) and are logged at warn; only failures an operator must act on are masked and logged as errors.

## Pitfalls

| Never | Symptom | Why |
|---|---|---|
| Read a scoped component (orders, stock, tasks, notifications, opportunities) over gRPC | `order(id: "<someone else's>")` returns it; every test is green | Component-to-component gRPC does not filter by caller; only the REST layers apply data scopes |
| Add a field to the schema without registering it in `FIELD_TO_DEPENDENCY` | Without its component the field stays in the schema; the app queries it and gets `null` forever, a blank page with no error | `src/schema.ts` cuts only registered fields; `test/resolvers.test.ts` checks the two tables match |
| Create a DataLoader at module level | One user's cached rows answer another user's request; single-request tests never see it | DataLoaders are built per request in `src/context.ts` |
| Put an ID into a path without `segment()` | `order(id: "7?view=all")` sends `?view=all` to `erp/sales` as a query; `../` rewrites the path | IDs come from the client; `encodeURIComponent` keeps them one path segment |
| Throw a plain `Error` for a downstream `4xx` or a caller-error gRPC status | The client sees `INTERNAL_SERVER_ERROR` and cannot tell "log in again" from "server down"; Yoga logs it as ERROR | Map it through `VISIBLE_STATUS` / `VISIBLE_GRPC_STATUS` to a `GraphQLError` |
| Copy a vendored `.proto` from an upstream's working tree | The field numbers can change before release; the BFF decodes a different message than the upstream sends | Take it only from the upstream's release tag and record the tag in `contracts/vendor/SOURCES.tsv` |
| Guess field names from the `.proto` | `proto-loader` turns `next_cursor` into `nextCursor` and returns enums as `PRODUCT_STATUS_ACTIVE` | `keepCase: false`, `enums: String`; strip prefixes with `stripEnumPrefix` |
| Build the image with the repository's empty manifest and expect queries to work | Every query is refused with `PersistedQueryOnly` (HTTP `400`); `/healthz` is green | Only manifest hashes are accepted; the mobile app's build supplies the manifest, in the image or through `PERSISTED_OPERATIONS_JSON` |
| Expect `PERSISTED_OPERATIONS_JSON` to add to the built-in manifest | The queries only in the image's manifest answer `PersistedQueryNotFound` | It replaces the built-in manifest entirely; a merged list is one nobody reviewed |

## Before changing code

1. Does the field's source component have row-level scopes? Then REST with `forwardGet` / `forwardPost`, never gRPC.
2. Is the new field registered in `src/dependencies.ts` and wrapped in `requirePermission` with a key from `assembly.yaml`?
3. Contract change? Append only: new fields, types, optional arguments. `make contract-check` compares against the last release tag.
4. A new write: is it one call to one component? Two calls means orchestration, which belongs in the business component.
5. Does every downstream refusal you add reach the client with its `extensions.code`, logged at warn and not error?
6. New behaviour → a failing test first, against the stubs in `test/harness.ts`.
7. Bump `metadata.version` (and `package.json`) before the first change after a release; update BRICKKIT.md and `docs/design.md` in the same commit as the code.

<!-- brickkit:managed:begin lang=en -->
<!-- maintained by brickkit (init, add, remove, upgrade, skills update): edits between these markers are overwritten -->

## BrickKit

This is a BrickKit component: `component.yaml` is all the platform reads. The rules it relies on:

- `configSchema` keys are the environment variable names the code reads. Never use a reserved name: `COMPONENT_ID`, `COMPONENT_VERSION`, `PORT`, `BRICKKIT_SERVED_MEMBERS`, `BRICKKIT_SERVED_MEMBERS_CONFIG`, or any `*_ENDPOINT`.
- Dependencies are exact versions. A dependency's address arrives as `<ID>_ENDPOINT`; an optional dependency that is absent has no variable at all, so read it with a fallback.
- `/healthz` checks only this process, never a dependency. The migration command runs from the same image and must fail on an argument it does not know.
- `BRICKKIT.md` travels to every project that uses this component and is read there without the repository: keep it in step with the code, with no relative links.
- Release: raise `metadata.version`, commit, push, `brickkit release`. `brickkit lint` checks the manifest and these docs — inside a project, run in this directory, it checks only this component (`--all` for the whole project).
- The full rules are in the `brickkit-component` skill (`.claude/skills/brickkit-component/SKILL.md` at the root of the project or repository where skills are installed; `brickkit skills update` installs it); for flags ask `brickkit <command> --help`; BrickKit's own documentation is `brickkit docs`.
<!-- brickkit:managed:end -->
