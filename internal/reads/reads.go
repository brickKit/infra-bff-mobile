// Package reads is one function per root field and nested field that reads an owner (docs/design.md, the queries):
// the owner's user surface with the caller's own credential (BM04), mapped to the schema's types (internal/model).
// Owners' cursors pass through as they are; limits are passed explicitly; masks and translations as given.
package reads

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/brickKit/be-sdk-go/v3/errs"
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

var uuidForm = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// id refuses an argument that is not a record id before the owner is asked: a path segment that is not an id may
// name another route of the owner (the worklist's /tasks/done).
func id(name, v string) error {
	if uuidForm.MatchString(v) {
		return nil
	}
	return errs.New(errs.ReasonRequestInvalid, "not a record id").WithViolations(
		errs.Violation{Field: name, Reason: "invalid", Description: "a lower-case UUID"})
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// masked is an owner's _masked (P8.31) as the GraphQL field names, never null: snake_case becomes lowerCamelCase,
// and a field whose GraphQL name differs is renamed (totals: total). The owner's null for a withheld field passes
// through the record's pointer fields as it is.
func masked(m []string, renames map[string]string) []string {
	out := make([]string, 0, len(m))
	for _, f := range m {
		if r, ok := renames[f]; ok {
			out = append(out, r)
			continue
		}
		parts := strings.Split(f, "_")
		for i := 1; i < len(parts); i++ {
			if parts[i] != "" {
				parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
			}
		}
		out = append(out, strings.Join(parts, ""))
	}
	return out
}
