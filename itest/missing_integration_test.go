//go:build integration

package itest

import (
	"net/http"
	"strings"
	"time"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// missing: an owner that is slow, refuses or is not installed leaves only its own part empty and named (BM06,
// BM07); the root fields run in parallel.
func (fx *fixture) missing() {
	t := fx.t
	fx.forget()
	defer fx.forget()

	// extOf checks the P3.3 extensions of the error at a path and returns them
	extOf := func(a answer, path ...any) map[string]any {
		t.Helper()
		e, ok := a.errorAt(path...)
		require.True(t, ok, "no error at %v: %s", path, a.Raw)
		require.NotNil(t, e.Extensions, a.Raw)
		assert.NotEmpty(t, e.Extensions["trace_id"], "trace_id at %v", path)
		assert.NotContains(t, a.Raw, "internal detail", "the owner's detail never passes (BM06, BM09)")
		return e.Extensions
	}
	dependencyOf := func(ext map[string]any) any {
		m, _ := ext["metadata"].(map[string]any)
		return m["dependency"]
	}

	// root fields in parallel: two owners each one second slow answer within well under two
	delay := func(w http.ResponseWriter, r *http.Request) bool { time.Sleep(time.Second); return false }
	fx.owners[core.Workflow].set(delay)
	fx.owners[core.Notification].set(delay)
	began := time.Now()
	a := fx.carol.query("home", nil)
	took := time.Since(began)
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	assert.Less(t, took, 1800*time.Millisecond, "the root fields run in parallel")
	fx.forget()

	// a slow owner: its field null with the dependency named, the other field as usual, inside the route's deadline
	fx.owners[core.Workflow].set(func(w http.ResponseWriter, r *http.Request) bool { <-r.Context().Done(); return true })
	began = time.Now()
	a = fx.carol.query("home", nil)
	took = time.Since(began)
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Less(t, took, 10*time.Second, "answered inside the route's deadline")
	assert.Nil(t, a.Data["myTasks"], a.Raw)
	require.NotNil(t, a.Data["myNotifications"], a.Raw)
	assert.EqualValues(t, 3, a.Data["myNotifications"].(map[string]any)["unread"])
	ext := extOf(a, "myTasks")
	assert.Contains(t, []any{"DEADLINE_EXCEEDED", "DEPENDENCY_UNAVAILABLE"}, ext["reason"], a.Raw)
	assert.Equal(t, core.Workflow, dependencyOf(ext))
	assert.NotNil(t, ext["retry_after"], "a retryable reason says when")
	fx.forget()

	// the owner's refusal: NOT_FOUND in the owner's domain, not retryable
	a = fx.carol.query("task", map[string]any{"component": "erp/purchase", "id": order1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Nil(t, a.Data["task"])
	ext = extOf(a, "task")
	assert.Equal(t, "NOT_FOUND", ext["reason"])
	assert.Equal(t, "infra/workflow", ext["domain"])
	assert.Nil(t, ext["retry_after"])

	// the owner does not take the forwarded credential: cannot confirm now, retryable, never a 401 to the client
	fx.owners[core.Sales].set(func(w http.ResponseWriter, r *http.Request) bool {
		problem(w, 401, "be", "TOKEN_STALE")
		return true
	})
	a = fx.carol.query("orders", nil)
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Nil(t, a.Data["myOrders"])
	ext = extOf(a, "myOrders")
	assert.Equal(t, "AUTHORIZATION_UNPROVABLE", ext["reason"])
	assert.Equal(t, core.Sales, dependencyOf(ext))
	assert.NotNil(t, ext["retry_after"])
	fx.forget()

	// a nested field fails: the product as usual, its stock null and named
	fx.owners[core.Inventory].set(func(w http.ResponseWriter, r *http.Request) bool {
		if strings.HasPrefix(r.URL.Path, "/api/inventory/positions") {
			problem(w, 503, "be", "DEPENDENCY_UNAVAILABLE")
			return true
		}
		return false
	})
	a = fx.carol.query("product", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	prod, ok := a.Data["product"].(map[string]any)
	require.True(t, ok, a.Raw)
	assert.Equal(t, product1, prod["id"])
	assert.Nil(t, prod["stock"])
	ext = extOf(a, "product", "stock")
	assert.Equal(t, core.Inventory, dependencyOf(ext))
	fx.forget()

	// the catalog fails: the positions as usual, unnamed, with the missing part named
	fx.owners[core.Inventory].set(func(w http.ResponseWriter, r *http.Request) bool {
		if strings.HasPrefix(r.URL.Path, "/api/inventory/warehouses") {
			problem(w, 503, "be", "DEPENDENCY_UNAVAILABLE")
			return true
		}
		return false
	})
	a = fx.carol.query("product", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	stock := a.Data["product"].(map[string]any)["stock"].([]any)
	require.Len(t, stock, 2, a.Raw)
	assert.Nil(t, stock[0].(map[string]any)["warehouse"].(map[string]any)["name"])
	assert.Equal(t, "4", stock[0].(map[string]any)["available"])
	ext = extOf(a, "product", "stock")
	assert.Equal(t, "DEPENDENCY_UNAVAILABLE", ext["reason"])
	assert.Equal(t, core.Inventory, dependencyOf(ext))
	fx.forget()

	// a deployment without crm/opportunity and erp/inventory: their fields are not in its schema, so the entries
	// that use them were refused at start; the rest works
	for _, name := range []string{"homeWithOpps", "opportunities", "opportunity", "product", "twoProducts"} {
		a = fx.few.query(name, map[string]any{"id": product1, "a": product1, "b": product2})
		assert.Equal(t, 400, a.Status, "%s: %s", name, a.Raw)
		assert.Equal(t, "PERSISTED_QUERY_NOT_FOUND", a.Prob["reason"], name)
	}
	a = fx.few.query("productBare", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Empty(t, a.Errors, a.Raw)
	a = fx.few.query("home", nil)
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Empty(t, a.Errors, a.Raw)
}
