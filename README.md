[English](README.md) · [中文](README.zh.md)

# infra/bff-mobile

GraphQL backend-for-frontend for the mobile app; a schema cut to the pages, batched loading, no business logic and no database.

## Use it in a project

```bash
brickkit add infra/bff-mobile@2.0.0
brickkit up
```

Prepare first: see "Before you deploy" in BRICKKIT.md (the authorization and JWKS URLs, and the mobile app's persisted-operation manifest in the image). Every dependency is optional; add the components whose data the mobile app should show.

## Documentation

| To find out | Read |
|---|---|
| What it does and does not do, how to configure it, what to prepare | [BRICKKIT.md](BRICKKIT.md) |
| Every query and mutation, with their arguments | [contracts/schema.graphql](contracts/schema.graphql) |
| Why it is designed this way: two read paths, schema cutting, writes, open questions | [docs/design.md](docs/design.md) |
| What it depends on (all optional) and its configuration keys | [component.yaml](component.yaml) |
| How to develop it: code map, tests, pitfalls | [AGENTS.md](AGENTS.md) |

## Development

TypeScript on Node 24, GraphQL Yoga through be-sdk-ts, `@grpc/grpc-js` with `@grpc/proto-loader`, vitest. `npm ci && make test` needs no container: the tests run the real server against local stubs. The commands and what success looks like are in AGENTS.md, section "Build and test". Inside the BrickEnterprise project, `make verify ID=infra/bff-mobile FOCUS=1` at the project root runs it for real and tears down afterwards.
