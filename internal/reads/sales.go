package reads

import (
	"context"
	"net/url"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	"github.com/brickKit/infra-bff-mobile/v3/internal/model"

	"github.com/brickKit/be-sdk-go/v3/errs"
)

// customerRef is the customer as a document recorded it.
type customerRef struct {
	PartnerID string `json:"partner_id"`
	Name      string `json:"name"`
}

// model is nil when the owner withheld the customer (P8.31).
func (c *customerRef) model() *model.CustomerRef {
	if c == nil {
		return nil
	}
	return &model.CustomerRef{PartnerID: c.PartnerID, Name: c.Name}
}

type orderRecord struct {
	ID            *string      `json:"id"`
	Number        *string      `json:"number"`
	LegalEntityID *string      `json:"legal_entity_id"`
	Customer      *customerRef `json:"customer"`
	Currency      *string      `json:"currency"`
	State         *string      `json:"state"`
	BusinessDate  *string      `json:"business_date"`
	Totals        *struct {
		Gross *string `json:"gross"`
	} `json:"totals"`
	UpdatedAt *string  `json:"updated_at"`
	Masked    []string `json:"_masked"`
}

func (x orderRecord) model() model.Order {
	o := model.Order{ID: x.ID, Number: x.Number, LegalEntityID: x.LegalEntityID, Customer: x.Customer.model(),
		Currency: x.Currency, State: x.State, BusinessDate: x.BusinessDate, UpdatedAt: x.UpdatedAt,
		Masked: masked(x.Masked, orderRenames)}
	if x.Totals != nil {
		o.Total = x.Totals.Gross
	}
	return o
}

// orderRenames: the order's totals are its total here.
var orderRenames = map[string]string{"totals": "total"}

// mine is the verified caller, the owner filter of "my" lists (BM04).
func mine(ctx context.Context) (string, error) {
	p, ok := core.Principal(ctx)
	if !ok {
		return "", errs.New(errs.ReasonInternal, "no verified caller on a protected route")
	}
	return p, nil
}

// MyOrders lists the sales orders I own (erp/sales GET /api/sales/orders?owner_id=<me>): without history the owner
// lists the open and recent ones.
func (r *Reads) MyOrders(ctx context.Context, state, cursor *string, limit *int) (*model.OrderPage, error) {
	me, err := mine(ctx)
	if err != nil {
		return nil, err
	}
	var out struct {
		Orders     []orderRecord `json:"orders"`
		NextCursor string        `json:"next_cursor"`
	}
	if err := r.b.Get(ctx, core.Sales, "/api/sales/orders", page(cursor, limit, "owner_id", me, "state", str(state)), &out); err != nil {
		return nil, err
	}
	p := &model.OrderPage{Items: make([]model.Order, 0, len(out.Orders)), NextCursor: out.NextCursor}
	for _, x := range out.Orders {
		p.Items = append(p.Items, x.model())
	}
	return p, nil
}

// Order is one sales order (erp/sales GET /api/sales/orders/{id}).
func (r *Reads) Order(ctx context.Context, recordID string) (*model.Order, error) {
	if err := id("id", recordID); err != nil {
		return nil, err
	}
	var x orderRecord
	if err := r.b.Get(ctx, core.Sales, "/api/sales/orders/"+url.PathEscape(recordID), nil, &x); err != nil {
		return nil, err
	}
	o := x.model()
	return &o, nil
}
