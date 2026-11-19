// Package reads is one function per root field and nested field that reads an owner (docs/design.md, the queries):
// the owner's user surface with the caller's own credential (BM04), mapped to the schema's types (internal/model).
// Owners' cursors pass through as they are; limits are passed explicitly; masks and translations as given.
package reads

import (
	"net/url"
	"strconv"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
)

// Reads is the read side over the owners the deployment has.
type Reads struct{ b *core.Base }

// New builds it.
func New(b *core.Base) *Reads { return &Reads{b: b} }

// DefaultLimit is a list field's limit when the query gives none (the schema's default).
const DefaultLimit = 20

// page builds a list query: the filters that are set, the cursor when given, the limit always.
func page(cursor *string, limit *int, filters ...string) url.Values {
	q := url.Values{}
	for i := 0; i+1 < len(filters); i += 2 {
		if filters[i+1] != "" {
			q.Set(filters[i], filters[i+1])
		}
	}
	if cursor != nil && *cursor != "" {
		q.Set("cursor", *cursor)
	}
	n := DefaultLimit
	if limit != nil {
		n = *limit
	}
	q.Set("limit", strconv.Itoa(n))
	return q
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// masked is an owner's _masked (P8.31), never null.
func masked(m []string) []string {
	if m == nil {
		return []string{}
	}
	return m
}
