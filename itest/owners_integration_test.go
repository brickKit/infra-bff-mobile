//go:build integration

package itest

// The stand-ins' answers, by each owner's published contract (its contract/openapi.yaml): the shapes, not the
// owners' rules. Ids are fixed so that the steps can name them.

import (
	"net/http"
	"strings"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
)

const (
	le1       = "0190f3a1-0000-7000-8000-00000000e001"
	product1  = "0190f3a1-0000-7000-8000-00000000b001"
	product2  = "0190f3a1-0000-7000-8000-00000000b002"
	wh1       = "0190f3a1-0000-7000-8000-00000000c001" // in the caller's warehouse catalog
	wh2       = "0190f3a1-0000-7000-8000-00000000c002" // a position the caller sees, its warehouse not
	partner1  = "0190f3a1-0000-7000-8000-00000000d001"
	order1    = "0190f3a1-0000-7000-8000-00000000f001"
	opp1      = "0190f3a1-0000-7000-8000-00000000f101"
	message1  = "0190f3a1-0000-7000-8000-00000000f201"
	at        = "2026-11-19T08:00:00.000000Z"
	actionURL = "/api/purchase/flow/tasks/" + purchaseTsk + "/decisions"
)

func ownerAnswer(owner string, w http.ResponseWriter, r *http.Request) {
	p, q := r.URL.Path, r.URL.Query()
	if r.Method != http.MethodGet {
		problem(w, 405, "be", "REQUEST_INVALID")
		return
	}
	switch {
	case owner == core.Workflow && p == "/api/workflow/tasks":
		if q.Get("cursor") == "c2" {
			writeJSON(w, 200, map[string]any{"tasks": []any{}, "next_cursor": ""})
			return
		}
		writeJSON(w, 200, map[string]any{"tasks": []any{worklistItem()}, "next_cursor": "c2"})
	case owner == core.Workflow && p == "/api/workflow/tasks/"+purchaseTsk && q.Get("component") == "erp/purchase":
		writeJSON(w, 200, worklistItem())
	case owner == core.Workflow && strings.HasPrefix(p, "/api/workflow/tasks/"):
		problem(w, 404, "be", "NOT_FOUND") // errs.New: a platform reason, domain be
	case owner == core.Notification && p == "/api/notification/messages":
		writeJSON(w, 200, map[string]any{"messages": []any{map[string]any{"id": message1, "sender": "erp/purchase",
			"category": "approval_task", "title": "Order P-1 waits for you", "link": "/purchase/orders/1",
			"template": "be.flow.task.assigned", "params": map[string]any{"number": "P-1"}, "created_at": at,
			"read_at": nil, "withdrawn": false}}, "unread": 3, "next_cursor": ""})
	case owner == core.Product && p == "/api/product/products":
		writeJSON(w, 200, map[string]any{"products": []any{productRecord(product1)}, "next_cursor": "p2"})
	case owner == core.Product && (p == "/api/product/products/"+product1 || p == "/api/product/products/"+product2):
		writeJSON(w, 200, productRecord(strings.TrimPrefix(p, "/api/product/products/")))
	case owner == core.Product && strings.HasPrefix(p, "/api/product/products/"):
		problem(w, 404, "be", "NOT_FOUND")
	case owner == core.Inventory && p == "/api/inventory/positions" && q.Get("product_id") == product2 && q.Get("cursor") == "":
		// two pages: the aggregation reads the next one
		writeJSON(w, 200, map[string]any{"positions": []any{position(product2, wh1, "5", "1", "4")}, "next_cursor": "pos2"})
	case owner == core.Inventory && p == "/api/inventory/positions" && q.Get("product_id") == product2:
		writeJSON(w, 200, map[string]any{"positions": []any{position(product2, wh2, "2", "0", "2")}, "next_cursor": ""})
	case owner == core.Inventory && p == "/api/inventory/positions":
		writeJSON(w, 200, map[string]any{"positions": []any{
			position(q.Get("product_id"), wh1, "5", "1", "4"), position(q.Get("product_id"), wh2, "2", "0", "2")},
			"next_cursor": ""})
	case owner == core.Inventory && p == "/api/inventory/warehouses":
		writeJSON(w, 200, map[string]any{"warehouses": []any{map[string]any{"id": wh1, "legal_entity_id": le1,
			"code": "WH-1", "name": "Main", "state": "active", "version": 1, "updated_at": at}}, "next_cursor": ""})
	case owner == core.Partner && p == "/api/partner/partners":
		writeJSON(w, 200, map[string]any{"partners": []any{partnerRecord()}, "next_cursor": ""})
	case owner == core.Partner && p == "/api/partner/partners/"+partner1:
		writeJSON(w, 200, partnerRecord())
	case owner == core.Sales && p == "/api/sales/orders":
		writeJSON(w, 200, map[string]any{"orders": []any{orderRecord()}, "next_cursor": "o2"})
	case owner == core.Sales && p == "/api/sales/orders/"+order1:
		// an archived order read through the SDK's Mask (P8.31): the customer and the totals withheld
		o := orderRecord()
		o["customer"], o["totals"], o["_masked"] = nil, nil, []any{"customer", "totals"}
		writeJSON(w, 200, o)
	case owner == core.Opportunity && p == "/api/opportunity/opportunities":
		writeJSON(w, 200, map[string]any{"opportunities": []any{oppRecord()}, "next_cursor": ""})
	case owner == core.Opportunity && p == "/api/opportunity/opportunities/"+opp1:
		writeJSON(w, 200, oppRecord())
	default:
		problem(w, 404, "be", "NOT_FOUND")
	}
}

// worklistItem is a worklist entry (infra/workflow): the task projection (be-protocol schemas/flow/task.v1) with the
// action entry the worklist derived.
func worklistItem() map[string]any {
	return map[string]any{"task": map[string]any{"id": purchaseTsk, "task_type": "erp.purchase.order.approval",
		"component": "erp/purchase", "document": map[string]any{"component": "erp/purchase", "type": "order",
			"id": order1, "number": "P-1"},
		"summary": map[string]any{"title": "Purchase order P-1", "fields": []any{
			map[string]any{"key": "supplier", "label": "Supplier", "value": "ACME"},
			map[string]any{"key": "gross", "label": "Total", "value": "1200.00 CNY"}}},
		"candidates": []any{carol}, "state": "pending", "paused_reason": nil, "decision": nil, "due_at": at,
		"instance": map[string]any{"id": opp1, "state": "running", "step": 1}, "legal_entity_id": le1, "version": 3,
		"updated_at": at},
		"action": map[string]any{"component": "erp/purchase", "path": actionURL}, "stale": true, "received_at": at}
}

func productRecord(id string) map[string]any {
	return map[string]any{"id": id, "code": "BOLT-" + id[len(id)-1:], "kind": "stock", "stocked": true, "name": "Bolt",
		"names": map[string]any{"en": "Bolt"}, "category_id": nil, "base_unit": "pcs", "tracking": "none",
		"has_movements": true, "conversions": []any{}, "availability": []any{}, "state": "active", "version": 2,
		"updated_at": at}
}

func position(product, warehouse, onHand, reserved, available string) map[string]any {
	return map[string]any{"id": warehouse + product, "product_id": product, "warehouse_id": warehouse,
		"legal_entity_id": le1, "on_hand": onHand, "reserved": reserved, "available": available, "version": 1,
		"updated_at": at}
}

func partnerRecord() map[string]any {
	return map[string]any{"id": partner1, "kind": "organization", "name": "Customer One",
		"names": map[string]any{"zh-CN": "客户一"}, "country": "CN", "tax_id": nil, "_masked": []any{"tax_id"},
		"state": "active", "contacts": []any{}, "addresses": []any{}, "version": 1, "updated_at": at}
}

func orderRecord() map[string]any {
	return map[string]any{"id": order1, "number": "SO-1", "legal_entity_id": le1,
		"customer": map[string]any{"partner_id": partner1, "name": "Customer One", "tax_id": nil}, "currency": "CNY",
		"owner_id": carol, "department_id": nil, "state": "confirmed", "business_date": "2026-11-18",
		"exchange_rate": nil, "revision": 1, "quotation_id": nil, "confirmation_id": nil, "reason": nil, "lines": []any{},
		"totals": map[string]any{"net": "100.00", "tax": "13.00", "gross": "113.00"}, "version": 4, "created_at": at,
		"updated_at": at}
}

func oppRecord() map[string]any {
	return map[string]any{"id": opp1, "number": "OP-1", "legal_entity_id": le1,
		"customer": map[string]any{"partner_id": partner1, "name": "Customer One"}, "name": "Bolts for 2027",
		"currency": "CNY", "amount": nil, "_masked": []any{"amount"}, "expected_close_date": "2026-12-31",
		"owner_id": carol, "stage": "proposal", "probability": 60, "stage_before_close": nil, "close_reason": nil,
		"closed_at": nil, "won_amount": nil, "lines": []any{}, "version": 1, "created_at": at, "updated_at": at}
}
