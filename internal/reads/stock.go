package reads

import (
	"context"
	"net/url"
	"strconv"
	"sync"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"

	"github.com/brickKit/be-sdk-go/v3/errs"
)

// request is what one request reads once (BM05): the caller's warehouse catalog. Nothing outlives the request.
type request struct {
	once    sync.Once
	catalog map[string]warehouse
	err     error
}

type warehouse struct {
	ID   string  `json:"id"`
	Code *string `json:"code"`
	Name *string `json:"name"`
}

type requestKey struct{}

// WithRequest starts a request's scope; the entry calls it for each request.
func WithRequest(ctx context.Context) context.Context {
	return context.WithValue(ctx, requestKey{}, &request{})
}

// catalog returns the caller's warehouses, read once per request: every page up to WarehousePages; more than that
// is an incomplete catalog (DEPENDENCY_UNAVAILABLE), the warehouses read so far still named.
func (r *Reads) catalog(ctx context.Context) (map[string]warehouse, error) {
	req, _ := ctx.Value(requestKey{}).(*request)
	if req == nil {
		req = &request{}
	}
	req.once.Do(func() {
		req.catalog = map[string]warehouse{}
		cursor := ""
		for range core.WarehousePages {
			q := url.Values{"limit": {strconv.Itoa(core.WarehousePageSize)}}
			if cursor != "" {
				q.Set("cursor", cursor)
			}
			var out struct {
				Warehouses []warehouse `json:"warehouses"`
				NextCursor string      `json:"next_cursor"`
			}
			if req.err = r.b.Get(ctx, core.Inventory, "/api/inventory/warehouses", q, &out); req.err != nil {
				return
			}
			for _, w := range out.Warehouses {
				req.catalog[w.ID] = w
			}
			if cursor = out.NextCursor; cursor == "" {
				return
			}
		}
		req.err = errs.New(errs.ReasonDependencyUnavailable, "more warehouses than one request names").
			With("dependency", core.Inventory)
	})
	return req.catalog, req.err
}

// position is erp/inventory's stock position as its user surface answers it (masked fields null, P8.31).
type position struct {
	WarehouseID *string  `json:"warehouse_id"`
	OnHand      *string  `json:"on_hand"`
	Reserved    *string  `json:"reserved"`
	Available   *string  `json:"available"`
	Masked      []string `json:"_masked"`
}

// positionRenames: a position's warehouse_id is its warehouse here.
var positionRenames = map[string]string{"warehouse_id": "warehouse"}

// Stock is a product's positions in the warehouses the caller may see (erp/inventory GET
// /api/inventory/positions?product_id=), every page up to WarehousePages, named from the request's catalog. What
// cannot be completed is a warning beside the positions read (BM05): the catalog not read (the positions unnamed),
// or more positions than one request reads (DEPENDENCY_UNAVAILABLE, never a silent cut).
func (r *Reads) Stock(ctx context.Context, productID string) ([]model.StockPosition, []error, error) {
	var (
		wg      sync.WaitGroup
		names   map[string]warehouse
		nameErr error
	)
	wg.Go(func() { names, nameErr = r.catalog(ctx) })
	var all []position
	var warnings []error
	cursor := ""
	for page := 0; ; page++ {
		if page == core.WarehousePages {
			warnings = append(warnings, errs.New(errs.ReasonDependencyUnavailable,
				"more stock positions than one request reads").With("dependency", core.Inventory))
			break
		}
		q := url.Values{"product_id": {productID}, "limit": {strconv.Itoa(core.WarehousePageSize)}}
		if cursor != "" {
			q.Set("cursor", cursor)
		}
		var out struct {
			Positions  []position `json:"positions"`
			NextCursor string     `json:"next_cursor"`
		}
		if err := r.b.Get(ctx, core.Inventory, "/api/inventory/positions", q, &out); err != nil {
			wg.Wait()
			return nil, nil, err
		}
		all = append(all, out.Positions...)
		if cursor = out.NextCursor; cursor == "" {
			break
		}
	}
	wg.Wait()
	if nameErr != nil {
		warnings = append(warnings, nameErr)
	}
	stock := make([]model.StockPosition, 0, len(all))
	for _, p := range all {
		w := &model.Warehouse{ID: p.WarehouseID}
		if p.WarehouseID != nil {
			if named, ok := names[*p.WarehouseID]; ok {
				w.Code, w.Name = named.Code, named.Name
			}
		}
		stock = append(stock, model.StockPosition{Warehouse: w, OnHand: p.OnHand, Reserved: p.Reserved,
			Available: p.Available, Masked: masked(p.Masked, positionRenames)})
	}
	return stock, warnings, nil
}
