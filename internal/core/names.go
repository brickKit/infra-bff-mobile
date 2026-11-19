// Package core is what every module of the mobile aggregation uses: its names, its resource and operation, the
// owners it reads and the limits of a query, and Base.
package core

import (
	sdkauthz "github.com/brickKit/be-sdk-go/v3/authz"
)

// ID is the component's ID.
const ID = "infra/bff-mobile"

// Domain is the domain of the component's own reasons (P3.3).
const Domain = ID

// KeyQueries is the persisted query list (BM02): a secret-typed key, so that BrickKit passes the content of a file://
// value without writing it into the deployment files, and the SDK takes BFF_PERSISTED_QUERIES_FILE outside BrickKit
// (the list itself is not secret).
const KeyQueries = "BFF_PERSISTED_QUERIES"

// The entry (BM01): one resource without dimensions and the one operation of its one route.
const (
	Entry   = "infra.bff_mobile.entry"
	OpEntry = "infra.bff_mobile.entry.use"
)

// The aggregated owners (docs/design.md, the dependencies): every one optional (BM07).
const (
	Workflow     = "infra/workflow"
	Notification = "infra/notification"
	Product      = "mdm/product"
	Inventory    = "erp/inventory"
	Partner      = "mdm/partner"
	Sales        = "erp/sales"
	Opportunity  = "crm/opportunity"
)

// Owners lists them in a fixed order.
var Owners = []string{Workflow, Notification, Product, Inventory, Partner, Sales, Opportunity}

// FieldOwners says which owner each field that reads one belongs to (BM07): "<type>.<field>". A field whose owner
// the deployment does not have is not registered.
var FieldOwners = map[string]string{
	"Query.myTasks": Workflow, "Query.task": Workflow,
	"Query.myNotifications": Notification,
	"Query.products":        Product, "Query.product": Product,
	"ProductDetail.stock": Inventory,
	"Query.customers":     Partner, "Query.customer": Partner,
	"Query.myOrders": Sales, "Query.order": Sales,
	"Query.myOpportunities": Opportunity, "Query.opportunity": Opportunity,
}

// The limits of a query (BM03).
const (
	MaxDepth   = 6
	MaxCost    = 200
	MaxAliases = 10
	// MaxLimit is the largest page a list field takes; the owners take up to 200.
	MaxLimit = 50
	// CallCost is the cost of a field that reads an owner; ObjectCost of any other field with a selection.
	CallCost   = 10
	ObjectCost = 1
)

// Warehouse catalog bounds (BM05): the pages of the caller's warehouses one request reads at most.
const (
	WarehousePages    = 5
	WarehousePageSize = 200
)

// Definitions are the component's resource and operation: the entry only; what a caller may see is each owner's
// decision (BM04).
func Definitions() *sdkauthz.Definitions {
	return &sdkauthz.Definitions{Component: ID,
		Resources: []sdkauthz.Resource{
			{Type: Entry, ViewOperation: OpEntry, Dimensions: map[string]sdkauthz.Dimension{}, Fields: map[string]sdkauthz.Field{}},
		},
		Operations: []sdkauthz.Operation{
			{Key: OpEntry, ResourceType: Entry, Purpose: "read", RiskClass: "low"},
		}}
}
