// Package queries is the persisted query list (BM02) and the limits of a query (BM03): which entries are taken, and
// the checks of a request's variables before execution. Pure functions over the schema; no I/O.
package queries

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	graph "github.com/brickKit/infra-bff-mobile/v3/internal/graph"

	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

// Rejected is one entry of the list that is not taken, and why.
type Rejected struct{ Hash, Why string }

// entry is a taken query: its text and the variables it passes as a list field's limit.
type entry struct {
	text      string
	limitVars []string
}

// List is the persisted queries taken, by the SHA-256 of their text.
type List struct{ entries map[string]entry }

var hashForm = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Load reads the list, a JSON object of query text by hash, and takes the entries that pass against the schema
// without the fields of the owners the deployment does not have (BM07). An entry that does not pass is rejected on
// its own; only a list that is not such an object is an error.
func Load(raw []byte, present func(owner string) bool) (*List, []Rejected, error) {
	var texts map[string]string
	if err := json.Unmarshal(raw, &texts); err != nil {
		return nil, nil, fmt.Errorf("the persisted query list is not a JSON object of query text by hash: %w", err)
	}
	schema, err := Schema(present)
	if err != nil {
		return nil, nil, err
	}
	l := &List{entries: map[string]entry{}}
	var rejected []Rejected
	hashes := make([]string, 0, len(texts))
	for h := range texts {
		hashes = append(hashes, h)
	}
	sort.Strings(hashes)
	for _, h := range hashes {
		e, why := take(schema, h, texts[h])
		if why != "" {
			rejected = append(rejected, Rejected{Hash: h, Why: why})
			continue
		}
		l.entries[h] = e
	}
	return l, rejected, nil
}

// Check checks a list against the full schema, for the mobile entry's build (check-manifest).
func Check(raw []byte) ([]Rejected, error) {
	_, rejected, err := Load(raw, func(string) bool { return true })
	return rejected, err
}

// Len is the number of taken queries.
func (l *List) Len() int { return len(l.entries) }

// Query returns the text of a taken query.
func (l *List) Query(hash string) (string, bool) {
	e, ok := l.entries[hash]
	return e.text, ok
}

// Schema is the schema without the fields whose owner is not present (BM07): a fresh copy, never the executor's.
func Schema(present func(owner string) bool) (*ast.Schema, error) {
	schema, err := gqlparser.LoadSchema(graph.Sources()...)
	if err != nil {
		return nil, fmt.Errorf("the schema does not load: %w", err)
	}
	for key, owner := range core.FieldOwners {
		if present(owner) {
			continue
		}
		typ, field, _ := strings.Cut(key, ".")
		def := schema.Types[typ]
		if def == nil {
			return nil, fmt.Errorf("the schema has no type %s for %s", typ, key)
		}
		kept := def.Fields[:0:0]
		for _, f := range def.Fields {
			if f.Name != field {
				kept = append(kept, f)
			}
		}
		def.Fields = kept
	}
	return schema, nil
}

// take checks one entry: its hash, its text against the schema, one query operation, no introspection, and the
// limits (BM03). It answers why it is not taken, or "".
func take(schema *ast.Schema, hash, text string) (entry, string) {
	if !hashForm.MatchString(hash) {
		return entry{}, "the key is not a lower-case hex SHA-256"
	}
	if sum := sha256.Sum256([]byte(text)); hex.EncodeToString(sum[:]) != hash {
		return entry{}, "the key is not the SHA-256 of the query text"
	}
	doc, gerrs := gqlparser.LoadQuery(schema, text)
	if len(gerrs) > 0 {
		return entry{}, "not valid against the schema: " + gerrs.Error()
	}
	if len(doc.Operations) != 1 {
		return entry{}, fmt.Sprintf("%d operations; one is allowed", len(doc.Operations))
	}
	op := doc.Operations[0]
	if op.Operation != ast.Query {
		return entry{}, "a " + string(op.Operation) + "; only queries are allowed"
	}
	w := &walk{doc: doc}
	depth := w.selections(op.SelectionSet, 1)
	switch {
	case w.introspection:
		return entry{}, "introspection is not allowed"
	case w.badLimit != "":
		return entry{}, w.badLimit
	case depth > core.MaxDepth:
		return entry{}, fmt.Sprintf("depth %d over %d", depth, core.MaxDepth)
	case w.aliases > core.MaxAliases:
		return entry{}, fmt.Sprintf("%d aliases over %d", w.aliases, core.MaxAliases)
	case w.cost > core.MaxCost:
		return entry{}, fmt.Sprintf("cost %d over %d", w.cost, core.MaxCost)
	}
	return entry{text: text, limitVars: w.limitVars}, ""
}

// walk measures an operation (BM03): the depth, the aliases, the cost (CallCost for a field that reads an owner,
// ObjectCost for any other field with a selection), introspection, the limit arguments.
type walk struct {
	doc           *ast.QueryDocument
	cost, aliases int
	introspection bool
	badLimit      string
	limitVars     []string
}

// selections returns the depth of a selection set whose fields are at the given level.
func (w *walk) selections(set ast.SelectionSet, level int) int {
	deepest := level - 1
	for _, s := range set {
		var d int
		switch s := s.(type) {
		case *ast.Field:
			d = w.field(s, level)
		case *ast.InlineFragment:
			d = w.selections(s.SelectionSet, level)
		case *ast.FragmentSpread:
			if f := w.doc.Fragments.ForName(s.Name); f != nil {
				d = w.selections(f.SelectionSet, level)
			}
		}
		deepest = max(deepest, d)
	}
	return deepest
}

func (w *walk) field(f *ast.Field, level int) int {
	if strings.HasPrefix(f.Name, "__") && f.Name != "__typename" {
		w.introspection = true
	}
	if f.Alias != "" && f.Alias != f.Name {
		w.aliases++
	}
	parent := ""
	if f.ObjectDefinition != nil {
		parent = f.ObjectDefinition.Name
	}
	switch {
	case core.FieldOwners[parent+"."+f.Name] != "":
		w.cost += core.CallCost
	case len(f.SelectionSet) > 0:
		w.cost += core.ObjectCost
	}
	for _, a := range f.Arguments {
		if a.Name != "limit" || a.Value == nil {
			continue
		}
		switch a.Value.Kind {
		case ast.Variable:
			w.limitVars = append(w.limitVars, a.Value.Raw)
		case ast.IntValue:
			if v, err := a.Value.Value(nil); err != nil || !inLimit(v) {
				w.badLimit = fmt.Sprintf("%s(limit: %s) is outside 1..%d", f.Name, a.Value.Raw, core.MaxLimit)
			}
		}
	}
	if len(f.SelectionSet) == 0 {
		return level
	}
	return w.selections(f.SelectionSet, level+1)
}

func inLimit(v any) bool {
	var n int64
	switch x := v.(type) {
	case int:
		n = int64(x)
	case int32:
		n = int64(x)
	case int64:
		n = x
	case float64:
		if x != float64(int64(x)) {
			return false
		}
		n = int64(x)
	case json.Number:
		i, err := x.Int64()
		if err != nil {
			return false
		}
		n = i
	default:
		return false
	}
	return n >= 1 && n <= core.MaxLimit
}

// Limits checks a request's coerced variables against the query's limits (BM03): every variable passed as a list
// field's limit is within 1..MaxLimit when given.
func (l *List) Limits(hash string, vars map[string]any) []errs.Violation {
	var out []errs.Violation
	for _, name := range l.entries[hash].limitVars {
		v, given := vars[name]
		if !given || v == nil || inLimit(v) {
			continue
		}
		out = append(out, errs.Violation{Field: "variables." + name, Reason: "out_of_range",
			Description: fmt.Sprintf("a limit is 1..%d", core.MaxLimit)})
	}
	return out
}
