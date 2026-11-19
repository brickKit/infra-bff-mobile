.PHONY: test test-integration lint generate

test:  ## unit tests: the manifest, the OpenAPI document and the route, merge safety, the persisted query checks
	go vet ./... && go test ./...

test-integration:  ## L2 against stand-ins of the owners (no database, no bus)
	go test -count=1 -tags integration ./itest/

lint:
	brickkit lint

generate:  ## the executor and the models from contract/schema.graphql (gqlgen; resolvers kept)
	go run github.com/99designs/gqlgen@v0.17.98 generate
