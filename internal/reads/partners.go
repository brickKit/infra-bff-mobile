package reads

import (
	"context"
	"net/url"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"
)

type partnerRecord struct {
	ID      string         `json:"id"`
	Kind    string         `json:"kind"`
	Name    string         `json:"name"`
	Names   map[string]any `json:"names"`
	Country *string        `json:"country"`
	TaxID   *string        `json:"tax_id"`
	State   string         `json:"state"`
	Masked  []string       `json:"_masked"`
}

func (x partnerRecord) model() model.Partner {
	return model.Partner{ID: x.ID, Kind: x.Kind, Name: x.Name, Names: x.Names, Country: x.Country, TaxID: x.TaxID,
		State: x.State, Masked: masked(x.Masked)}
}

// Customers lists partners with an active customer role (mdm/partner GET /api/partner/partners?role=customer).
func (r *Reads) Customers(ctx context.Context, legalEntityID, q, cursor *string, limit *int) (*model.PartnerPage, error) {
	var out struct {
		Partners   []partnerRecord `json:"partners"`
		NextCursor string          `json:"next_cursor"`
	}
	query := page(cursor, limit, "role", "customer", "legal_entity_id", str(legalEntityID), "q", str(q))
	if err := r.b.Get(ctx, core.Partner, "/api/partner/partners", query, &out); err != nil {
		return nil, err
	}
	p := &model.PartnerPage{Items: make([]model.Partner, 0, len(out.Partners)), NextCursor: out.NextCursor}
	for _, x := range out.Partners {
		p.Items = append(p.Items, x.model())
	}
	return p, nil
}

// Customer is one partner (mdm/partner GET /api/partner/partners/{id}).
func (r *Reads) Customer(ctx context.Context, id string) (*model.Partner, error) {
	var x partnerRecord
	if err := r.b.Get(ctx, core.Partner, "/api/partner/partners/"+url.PathEscape(id), nil, &x); err != nil {
		return nil, err
	}
	p := x.model()
	return &p, nil
}
