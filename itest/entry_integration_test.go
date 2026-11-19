//go:build integration

package itest

import (
	"fmt"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// entry: the route's own refusals (BM01-BM03), each before any owner is asked.
func (fx *fixture) entry() {
	t := fx.t
	fx.forget()
	noOwnerAsked := func(step string) {
		t.Helper()
		for id, s := range fx.owners {
			assert.Empty(t, s.requests(), "%s: %s was asked", step, id)
		}
	}

	// no entry operation: 403, nothing called
	a := fx.dave.query("home", nil)
	require.Equal(t, 403, a.Status, a.Raw)
	assert.Equal(t, "PERMISSION_DENIED", a.Prob["reason"])
	noOwnerAsked("no grant")

	// no credential: 401 (the SDK's admission)
	a = client{t, itBase, ""}.query("home", nil)
	assert.Equal(t, 401, a.Status, a.Raw)
	noOwnerAsked("no credential")

	// a hash not in the list, and an entry listed under a hash that is not its text's
	for _, h := range []string{hashOf("query X { myTasks { nextCursor } }"), wrongHash} {
		a = fx.carol.byHash(h, nil)
		require.Equal(t, 400, a.Status, a.Raw)
		assert.Equal(t, "PERSISTED_QUERY_NOT_FOUND", a.Prob["reason"])
		assert.Equal(t, "infra/bff-mobile", a.Prob["domain"])
	}
	noOwnerAsked("unknown hash")

	// bodies that are not a persisted query: the text itself, no extensions, another version, a bad hash
	tasks := hashOf(queries["tasks"])
	for i, body := range []map[string]any{
		{"query": queries["tasks"]},
		{"query": queries["tasks"], "extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": tasks}}},
		{"variables": map[string]any{}},
		{"extensions": map[string]any{"persistedQuery": map[string]any{"version": 2, "sha256Hash": tasks}}},
		{"extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": "ABC"}}},
		{"extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": tasks}, "more": 1}},
	} {
		a = fx.carol.post(body)
		assert.Equal(t, 400, a.Status, "body %d: %s", i, a.Raw)
		assert.Equal(t, "REQUEST_INVALID", a.Prob["reason"], "body %d", i)
	}
	noOwnerAsked("bad body")

	// a limit outside 1..50 (BM03), a variable of the wrong type, a required variable missing
	for _, limit := range []any{51, 0, -1} {
		a = fx.carol.query("tasks", map[string]any{"limit": limit})
		require.Equal(t, 400, a.Status, "limit %v: %s", limit, a.Raw)
		assert.Equal(t, "REQUEST_INVALID", a.Prob["reason"])
		assert.Contains(t, fmt.Sprint(a.Prob["violations"]), "limit", "limit %v", limit)
	}
	a = fx.carol.query("tasks", map[string]any{"limit": "many"})
	assert.Equal(t, 400, a.Status, a.Raw)
	assert.Equal(t, "REQUEST_INVALID", a.Prob["reason"])
	a = fx.carol.query("task", map[string]any{"component": "erp/purchase"})
	assert.Equal(t, 400, a.Status, a.Raw)
	assert.Equal(t, "REQUEST_INVALID", a.Prob["reason"])
	noOwnerAsked("limits and variables")

	// the limit at its bound passes
	a = fx.carol.query("tasks", map[string]any{"limit": 50})
	assert.Equal(t, 200, a.Status, a.Raw)
}
