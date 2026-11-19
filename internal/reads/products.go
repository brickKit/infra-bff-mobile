package reads

import (
	"context"
	"net/url"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"
)

// productRecord is mdm/product's product as its user surface answers it (its changed event's shape, masked).
type productRecord struct {
	ID       *string        `json:"id"`
	Code     *string        `json:"code"`
	Kind     *string        `json:"kind"`
	Name     *string        `json:"name"`
	Names    map[string]any `json:"names"`
	BaseUnit *string        `json:"base_unit"`
	State    *string        `json:"state"`
	Masked   []string       `json:"_masked"`
}

// Products searches products (mdm/product GET /api/product/products): no stock in a list (BM05).
func (r *Reads) Products(ctx context.Context, q, cursor *string, limit *int) (*model.ProductPage, error) {
	var out struct {
		Products   []productRecord `json:"products"`
		NextCursor string          `json:"next_cursor"`
	}
	if err := r.b.Get(ctx, core.Product, "/api/product/products", page(cursor, limit, "q", str(q)), &out); err != nil {
		return nil, err
	}
	p := &model.ProductPage{Items: make([]model.Product, 0, len(out.Products)), NextCursor: out.NextCursor}
	for _, x := range out.Products {
		p.Items = append(p.Items, model.Product{ID: x.ID, Code: x.Code, Kind: x.Kind, Name: x.Name, Names: x.Names,
			BaseUnit: x.BaseUnit, State: x.State, Masked: masked(x.Masked, nil)})
	}
	return p, nil
}

// Product is one product (mdm/product GET /api/product/products/{id}); its stock is the nested field Stock.
func (r *Reads) Product(ctx context.Context, recordID string) (*model.ProductDetail, error) {
	if err := id("id", recordID); err != nil {
		return nil, err
	}
	var x productRecord
	if err := r.b.Get(ctx, core.Product, "/api/product/products/"+url.PathEscape(recordID), nil, &x); err != nil {
		return nil, err
	}
	return &model.ProductDetail{ID: x.ID, Code: x.Code, Kind: x.Kind, Name: x.Name, Names: x.Names,
		BaseUnit: x.BaseUnit, State: x.State, Masked: masked(x.Masked, nil)}, nil
}
