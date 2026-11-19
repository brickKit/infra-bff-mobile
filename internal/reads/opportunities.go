package reads

import (
	"context"
	"net/url"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"
)

type oppRecord struct {
	ID                *string      `json:"id"`
	Number            *string      `json:"number"`
	Name              *string      `json:"name"`
	Customer          *customerRef `json:"customer"`
	Currency          *string      `json:"currency"`
	Amount            *string      `json:"amount"`
	Stage             *string      `json:"stage"`
	Probability       *int         `json:"probability"`
	ExpectedCloseDate *string      `json:"expected_close_date"`
	UpdatedAt         *string      `json:"updated_at"`
	Masked            []string     `json:"_masked"`
}

func (x oppRecord) model() model.Opportunity {
	return model.Opportunity{ID: x.ID, Number: x.Number, Name: x.Name, Customer: x.Customer.model(),
		Currency: x.Currency, Amount: x.Amount, Stage: x.Stage, Probability: x.Probability,
		ExpectedCloseDate: x.ExpectedCloseDate, UpdatedAt: x.UpdatedAt, Masked: masked(x.Masked, nil)}
}

// MyOpportunities lists the opportunities I own (crm/opportunity GET /api/opportunity/opportunities?owner_id=<me>).
func (r *Reads) MyOpportunities(ctx context.Context, stage, cursor *string, limit *int) (*model.OpportunityPage, error) {
	me, err := mine(ctx)
	if err != nil {
		return nil, err
	}
	var out struct {
		Opportunities []oppRecord `json:"opportunities"`
		NextCursor    string      `json:"next_cursor"`
	}
	query := page(cursor, limit, "owner_id", me, "stage", str(stage))
	if err := r.b.Get(ctx, core.Opportunity, "/api/opportunity/opportunities", query, &out); err != nil {
		return nil, err
	}
	p := &model.OpportunityPage{Items: make([]model.Opportunity, 0, len(out.Opportunities)), NextCursor: out.NextCursor}
	for _, x := range out.Opportunities {
		p.Items = append(p.Items, x.model())
	}
	return p, nil
}

// Opportunity is one opportunity (crm/opportunity GET /api/opportunity/opportunities/{id}).
func (r *Reads) Opportunity(ctx context.Context, recordID string) (*model.Opportunity, error) {
	if err := id("id", recordID); err != nil {
		return nil, err
	}
	var x oppRecord
	if err := r.b.Get(ctx, core.Opportunity, "/api/opportunity/opportunities/"+url.PathEscape(recordID), nil, &x); err != nil {
		return nil, err
	}
	o := x.model()
	return &o, nil
}
