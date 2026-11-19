//go:build integration

package itest

import (
	"net/http"
	"strings"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// bounds: what one request reads is bounded and never cut silently (BM05); an argument that is not a record id is
// refused before the owner is asked.
func (fx *fixture) bounds() {
	t := fx.t
	fx.forget()
	defer fx.forget()
	endless := func(list string) func(w http.ResponseWriter, r *http.Request) bool {
		return func(w http.ResponseWriter, r *http.Request) bool {
			switch {
			case list == "warehouses" && strings.HasPrefix(r.URL.Path, "/api/inventory/warehouses"):
				writeJSON(w, 200, map[string]any{"warehouses": []any{map[string]any{"id": wh1, "legal_entity_id": le1,
					"code": "WH-1", "name": "Main", "state": "active", "version": 1, "updated_at": at}},
					"next_cursor": "more"})
			case list == "positions" && strings.HasPrefix(r.URL.Path, "/api/inventory/positions"):
				writeJSON(w, 200, map[string]any{"positions": []any{position(product1, wh1, "5", "1", "4")},
					"next_cursor": "more"})
			default:
				return false
			}
			return true
		}
	}
	pages := func(path string) int {
		n := 0
		for _, s := range fx.owners[core.Inventory].requests() {
			if strings.HasPrefix(s.Path, path) {
				n++
			}
		}
		return n
	}

	// a catalog with more pages than one request reads: the stock as usual, the warehouses read named, the cut named
	fx.owners[core.Inventory].set(endless("warehouses"))
	a := fx.carol.query("product", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	stock := a.Data["product"].(map[string]any)["stock"].([]any)
	require.Len(t, stock, 2, a.Raw)
	assert.Equal(t, "Main", stock[0].(map[string]any)["warehouse"].(map[string]any)["name"])
	e, ok := a.errorAt("product", "stock")
	require.True(t, ok, a.Raw)
	assert.Equal(t, "DEPENDENCY_UNAVAILABLE", e.Extensions["reason"])
	assert.Equal(t, core.WarehousePages, pages("/api/inventory/warehouses"))
	fx.forget()

	// more positions than one request reads: those read, and the cut named, never a silent first page
	fx.owners[core.Inventory].set(endless("positions"))
	a = fx.carol.query("product", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	stock = a.Data["product"].(map[string]any)["stock"].([]any)
	assert.Len(t, stock, core.WarehousePages, a.Raw)
	e, ok = a.errorAt("product", "stock")
	require.True(t, ok, a.Raw)
	assert.Equal(t, "DEPENDENCY_UNAVAILABLE", e.Extensions["reason"])
	assert.Equal(t, core.Inventory, e.Extensions["metadata"].(map[string]any)["dependency"])
	assert.Equal(t, core.WarehousePages, pages("/api/inventory/positions"))
	fx.forget()

	// not a record id: refused on the field, the owner not asked (the worklist's /tasks/done is a route of its own)
	a = fx.carol.query("task", map[string]any{"component": "erp/purchase", "id": "done"})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Nil(t, a.Data["task"])
	e, ok = a.errorAt("task")
	require.True(t, ok, a.Raw)
	assert.Equal(t, "REQUEST_INVALID", e.Extensions["reason"])
	assert.Empty(t, fx.owners[core.Workflow].requests())
}
