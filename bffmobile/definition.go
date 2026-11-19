// Package bffmobile is the mobile entry's read-only aggregation (docs/design.md): page-shaped GraphQL queries over the
// owners' user surfaces, each read with the caller's own credential, by persisted query only.
package bffmobile

import (
	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/brickKit/be-sdk-go/v3/component"
	"github.com/brickKit/be-sdk-go/v3/config"
	"github.com/brickKit/be-sdk-go/v3/runtime"
)

// Version is the version this code is.
const Version = "3.0.2"

// Keys are the component's own configuration keys.
func Keys() []config.Key {
	return []config.Key{{Name: core.KeyQueries, Type: config.String, Secret: true}}
}

// Own describes the own keys for the manifest's configSchema.
var Own = map[string]string{
	core.KeyQueries: "the persisted queries (BM02): a JSON object of query text by its SHA-256 (lower-case hex); " +
		"write file://<path> in the component's config (BrickKit passes the content), or set " +
		"BFF_PERSISTED_QUERIES_FILE outside BrickKit; unset: every query is refused",
}

// Definition is the component as the launcher and the shells take it: no database, no bus, no system surface.
func Definition() component.Definition {
	return component.Definition{ID: core.ID, Version: Version, Keys: Keys(), Authz: core.Definitions(),
		New: func(rt *runtime.Runtime) (component.Module, error) { return New(rt) }}
}
