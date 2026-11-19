//go:build integration

package itest

import (
	"net/url"
	"strings"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// reads: every root field reads its owner's user surface with the caller's own credential (BM04), maps the answer
// to the schema, passes cursors, masks and translations through, and reads the warehouse catalog once (BM05).
func (fx *fixture) reads() {
	t := fx.t
	fx.forget()
	bearer := fx.w.Bearer(carol)
	only := func(owner string) []seen {
		t.Helper()
		got := fx.owners[owner].requests()
		for _, s := range got {
			assert.Equal(t, "GET", s.Method, "%s %s", owner, s.Path)
			assert.Equal(t, bearer, s.Auth, "%s %s: the caller's own credential", owner, s.Path)
		}
		return got
	}
	query := func(s seen) url.Values {
		u, err := url.Parse(s.Path)
		require.NoError(t, err)
		return u.Query()
	}

	// my tasks and my notifications: one request, both owners
	a := fx.carol.query("home", map[string]any{"limit": 20})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	page := a.Data["myTasks"].(map[string]any)
	assert.Equal(t, "c2", page["nextCursor"])
	items := page["items"].([]any)
	require.Len(t, items, 1)
	task := items[0].(map[string]any)
	assert.Equal(t, purchaseTsk, task["id"])
	assert.Equal(t, "erp/purchase", task["component"])
	assert.Equal(t, "erp.purchase.order.approval", task["taskType"])
	assert.Equal(t, "open", task["state"])
	assert.EqualValues(t, 3, task["version"])
	assert.Equal(t, at, task["dueAt"])
	assert.Equal(t, true, task["stale"])
	assert.Equal(t, at, task["receivedAt"])
	assert.Equal(t, map[string]any{"component": "erp/purchase", "path": actionURL}, task["action"])
	summary := task["summary"].(map[string]any)
	assert.Equal(t, "Purchase order P-1", summary["title"])
	assert.Equal(t, []any{map[string]any{"key": "supplier", "label": "Supplier", "value": "ACME"},
		map[string]any{"key": "gross", "label": "Total", "value": "1200.00 CNY"}}, summary["fields"])
	got := only(core.Workflow)
	require.Len(t, got, 1)
	assert.Equal(t, "/api/workflow/tasks", strings.Split(got[0].Path, "?")[0])
	assert.Equal(t, "20", query(got[0]).Get("limit"))
	notes := a.Data["myNotifications"].(map[string]any)
	assert.EqualValues(t, 3, notes["unread"])
	note := notes["items"].([]any)[0].(map[string]any)
	assert.Equal(t, message1, note["id"])
	assert.Equal(t, "approval_task", note["category"])
	assert.Equal(t, map[string]any{"number": "P-1"}, note["params"])
	assert.Nil(t, note["readAt"])
	assert.Equal(t, false, note["withdrawn"])
	got = only(core.Notification)
	require.Len(t, got, 1)
	assert.Equal(t, "true", query(got[0]).Get("unread"))
	assert.Equal(t, "5", query(got[0]).Get("limit"))

	// the next page: the owner's cursor back as it was; the default limit is passed explicitly
	a = fx.carol.query("tasks", map[string]any{"cursor": "c2"})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Equal(t, "", a.Data["myTasks"].(map[string]any)["nextCursor"])
	got = only(core.Workflow)
	require.Len(t, got, 1)
	assert.Equal(t, "c2", query(got[0]).Get("cursor"))
	assert.Equal(t, "20", query(got[0]).Get("limit"))

	// one task: its component and id
	a = fx.carol.query("task", map[string]any{"component": "erp/purchase", "id": purchaseTsk})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	assert.Equal(t, actionURL, a.Data["task"].(map[string]any)["action"].(map[string]any)["path"])
	got = only(core.Workflow)
	require.Len(t, got, 1)
	assert.Equal(t, "/api/workflow/tasks/"+purchaseTsk, strings.Split(got[0].Path, "?")[0])
	assert.Equal(t, "erp/purchase", query(got[0]).Get("component"))

	// products: the search passed on, a masked field null and named
	a = fx.carol.query("products", map[string]any{"q": "bolt-secret-term"})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	p := a.Data["products"].(map[string]any)["items"].([]any)[0].(map[string]any)
	assert.Equal(t, product1, p["id"])
	assert.Equal(t, "pcs", p["baseUnit"])
	assert.Nil(t, p["names"])
	assert.Equal(t, []any{"names"}, p["masked"])
	assert.Equal(t, "p2", a.Data["products"].(map[string]any)["nextCursor"])
	got = only(core.Product)
	require.Len(t, got, 1)
	assert.Equal(t, "bolt-secret-term", query(got[0]).Get("q"))
	assert.Equal(t, "10", query(got[0]).Get("limit"))
	assert.Empty(t, only(core.Inventory), "a product list never reads stock")

	// a product's stock: its positions, named from the catalog read once; a warehouse I cannot see is unnamed
	a = fx.carol.query("product", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	stock := a.Data["product"].(map[string]any)["stock"].([]any)
	require.Len(t, stock, 2)
	s1, s2 := stock[0].(map[string]any), stock[1].(map[string]any)
	assert.Equal(t, map[string]any{"id": wh1, "code": "WH-1", "name": "Main"}, s1["warehouse"])
	assert.Equal(t, "5", s1["onHand"])
	assert.Equal(t, "1", s1["reserved"])
	assert.Equal(t, "4", s1["available"])
	assert.Equal(t, map[string]any{"id": wh2, "code": nil, "name": nil}, s2["warehouse"])
	inv := only(core.Inventory)
	require.Len(t, inv, 2, "the positions and the catalog")
	paths := []string{strings.Split(inv[0].Path, "?")[0], strings.Split(inv[1].Path, "?")[0]}
	assert.ElementsMatch(t, []string{"/api/inventory/positions", "/api/inventory/warehouses"}, paths)
	for _, s := range inv {
		if strings.HasPrefix(s.Path, "/api/inventory/positions") {
			assert.Equal(t, product1, query(s).Get("product_id"))
		}
	}
	only(core.Product)

	// two products in one request: the catalog once
	a = fx.carol.query("twoProducts", map[string]any{"a": product1, "b": product2})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	catalog := 0
	for _, s := range only(core.Inventory) {
		if strings.HasPrefix(s.Path, "/api/inventory/warehouses") {
			catalog++
		}
	}
	assert.Equal(t, 1, catalog, "the warehouse catalog is read once per request")
	only(core.Product)

	// a product without its stock asked: inventory is not called
	a = fx.carol.query("productBare", map[string]any{"id": product1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Empty(t, only(core.Inventory))
	only(core.Product)

	// customers: the customer role, in a legal entity; translations as the owner gave them
	a = fx.carol.query("customers", map[string]any{"le": le1, "q": "one"})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	c := a.Data["customers"].(map[string]any)["items"].([]any)[0].(map[string]any)
	assert.Equal(t, map[string]any{"zh-CN": "客户一"}, c["names"])
	assert.Equal(t, []any{"tax_id"}, c["masked"])
	assert.Nil(t, c["taxId"])
	got = only(core.Partner)
	require.Len(t, got, 1)
	assert.Equal(t, "customer", query(got[0]).Get("role"))
	assert.Equal(t, le1, query(got[0]).Get("legal_entity_id"))
	assert.Equal(t, "one", query(got[0]).Get("q"))
	a = fx.carol.query("customer", map[string]any{"id": partner1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Equal(t, "Customer One", a.Data["customer"].(map[string]any)["name"])
	only(core.Partner)

	// my orders: owner_id is the verified principal, never a variable; the total is the gross
	a = fx.carol.query("orders", map[string]any{"state": "confirmed"})
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	o := a.Data["myOrders"].(map[string]any)["items"].([]any)[0].(map[string]any)
	assert.Equal(t, "SO-1", o["number"])
	assert.Equal(t, "113.00", o["total"])
	assert.Equal(t, map[string]any{"partnerId": partner1, "name": "Customer One"}, o["customer"])
	assert.Equal(t, "2026-11-18", o["businessDate"])
	assert.Equal(t, []any{}, o["masked"])
	got = only(core.Sales)
	require.Len(t, got, 1)
	assert.Equal(t, carol, query(got[0]).Get("owner_id"))
	assert.Equal(t, "confirmed", query(got[0]).Get("state"))
	a = fx.carol.query("order", map[string]any{"id": order1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Equal(t, "113.00", a.Data["order"].(map[string]any)["total"])
	only(core.Sales)

	// my opportunities: owner and stage; a masked amount
	a = fx.carol.query("opportunities", nil)
	require.Equal(t, 200, a.Status, a.Raw)
	require.Empty(t, a.Errors, a.Raw)
	op := a.Data["myOpportunities"].(map[string]any)["items"].([]any)[0].(map[string]any)
	assert.Nil(t, op["amount"])
	assert.Equal(t, []any{"amount"}, op["masked"])
	assert.EqualValues(t, 60, op["probability"])
	assert.Equal(t, "2026-12-31", op["expectedCloseDate"])
	got = only(core.Opportunity)
	require.Len(t, got, 1)
	assert.Equal(t, carol, query(got[0]).Get("owner_id"))
	assert.Equal(t, "proposal", query(got[0]).Get("stage"))
	a = fx.carol.query("opportunity", map[string]any{"id": opp1})
	require.Equal(t, 200, a.Status, a.Raw)
	assert.Equal(t, "Bolts for 2027", a.Data["opportunity"].(map[string]any)["name"])
	only(core.Opportunity)
}
