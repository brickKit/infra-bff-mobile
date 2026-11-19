package bffmobile

import (
	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	entry "github.com/brickKit/infra-bff-mobile/v3/internal/entry"

	"github.com/brickKit/be-sdk-go/v3/httpx"
	"github.com/brickKit/be-sdk-go/v3/runtime"
)

// Module is the aggregation as the launcher and the shells run it: it only assembles the modules under internal/
// (their map is internal/AGENTS.md).
type Module struct {
	e *entry.Entry
}

// New builds the module from its runtime: the owners the deployment has, the schema without the others (BM07) and
// the persisted queries checked against it (BM02).
func New(rt *runtime.Runtime) (*Module, error) {
	e, err := entry.New(rt)
	if err != nil {
		return nil, err
	}
	return &Module{e: e}, nil
}

// Path is the one route (BM01), under the default public prefix /api/bff-mobile.
const Path = "/api/bff-mobile/graphql"

// Routes registers the user surface (contract/openapi.yaml).
func (m *Module) Routes(r *httpx.Routes) error {
	r.Add(httpx.Route{Method: "POST", Path: Path, Operation: core.OpEntry, Handle: func(c *httpx.Context) error {
		return m.e.Serve(c)
	}})
	return nil
}
