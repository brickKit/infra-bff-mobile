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
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
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

// Stock is a product's positions in the warehouses the caller may see (erp/inventory GET
// /api/inventory/positions?product_id=), named from the request's catalog. A catalog that cannot be read leaves the
// positions unnamed, with its error (named answers the warning; the positions stand).
func (r *Reads) Stock(ctx context.Context, productID string) ([]model.StockPosition, error, error) {
	var (
		wg      sync.WaitGroup
		names   map[string]warehouse
		nameErr error
	)
	wg.Go(func() { names, nameErr = r.catalog(ctx) })
	var out struct {
		Positions []struct {
			WarehouseID string `json:"warehouse_id"`
			OnHand      string `json:"on_hand"`
			Reserved    string `json:"reserved"`
			Available   string `json:"available"`
		} `json:"positions"`
	}
	q := url.Values{"product_id": {productID}, "limit": {strconv.Itoa(core.WarehousePageSize)}}
	err := r.b.Get(ctx, core.Inventory, "/api/inventory/positions", q, &out)
	wg.Wait()
	if err != nil {
		return nil, nil, err
	}
	stock := make([]model.StockPosition, 0, len(out.Positions))
	for _, p := range out.Positions {
		w := &model.Warehouse{ID: p.WarehouseID}
		if named, ok := names[p.WarehouseID]; ok {
			code, name := named.Code, named.Name
			w.Code, w.Name = &code, &name
		}
		stock = append(stock, model.StockPosition{Warehouse: w, OnHand: p.OnHand, Reserved: p.Reserved,
			Available: p.Available})
	}
	return stock, nameErr, nil
}
