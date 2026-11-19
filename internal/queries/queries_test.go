package queries

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"
)

func hashOf(q string) string { s := sha256.Sum256([]byte(q)); return hex.EncodeToString(s[:]) }

func all(string) bool { return true }

// TestEveryOwnedFieldIsInTheSchema: a renamed field would silently stay registered without its owner (BM07).
func TestEveryOwnedFieldIsInTheSchema(t *testing.T) {
	schema, err := Schema(all)
	require.NoError(t, err)
	for key := range core.FieldOwners {
		typ, field, _ := strings.Cut(key, ".")
		require.NotNil(t, schema.Types[typ], key)
		assert.NotNil(t, schema.Types[typ].Fields.ForName(field), key)
	}
	// and every Query field has an owner
	for _, f := range schema.Query.Fields {
		if !strings.HasPrefix(f.Name, "__") {
			assert.NotEmpty(t, core.FieldOwners["Query."+f.Name], "Query.%s has no owner", f.Name)
		}
	}
}

// TestAnAbsentOwnersFieldsAreNotInTheSchema (BM07).
func TestAnAbsentOwnersFieldsAreNotInTheSchema(t *testing.T) {
	schema, err := Schema(func(o string) bool { return o != core.Inventory && o != core.Opportunity })
	require.NoError(t, err)
	assert.Nil(t, schema.Query.Fields.ForName("myOpportunities"))
	assert.Nil(t, schema.Query.Fields.ForName("opportunity"))
	assert.Nil(t, schema.Types["ProductDetail"].Fields.ForName("stock"))
	assert.NotNil(t, schema.Query.Fields.ForName("product"))
	full, err := Schema(all)
	require.NoError(t, err)
	assert.NotNil(t, full.Types["ProductDetail"].Fields.ForName("stock"), "pruning a copy never touches another")
}

func load(t *testing.T, present func(string) bool, texts ...string) (*List, map[string]string) {
	t.Helper()
	m := map[string]string{}
	for _, q := range texts {
		m[hashOf(q)] = q
	}
	raw, err := json.Marshal(m)
	require.NoError(t, err)
	l, rejected, err := Load(raw, present)
	require.NoError(t, err)
	why := map[string]string{}
	for _, r := range rejected {
		why[r.Hash] = r.Why
	}
	return l, why
}

func TestTheListTakesQueriesAndRefusesTheRest(t *testing.T) {
	good := `query G($l: Int) { myTasks(limit: $l) { items { id } nextCursor } }`
	cases := map[string]string{
		`mutation M { myTasks { nextCursor } }`:                                    "not valid",
		`query I { __schema { types { name } } }`:                                  "introspection",
		`query I2 { __type(name: "Task") { name } }`:                               "introspection",
		`query L { myTasks(limit: 51) { nextCursor } }`:                            "outside 1..50",
		`query Z { myTasks(limit: 0) { nextCursor } }`:                             "outside 1..50",
		`query One { myTasks { nextCursor } } query Two { order(id: "1") { id } }`: "2 operations",
		`query U { nope }`: "not valid",
	}
	texts := []string{good, `query T { __typename myTasks { nextCursor } }`}
	for q := range cases {
		texts = append(texts, q)
	}
	l, why := load(t, all, texts...)
	assert.Equal(t, 2, l.Len())
	_, ok := l.Query(hashOf(good))
	assert.True(t, ok)
	for q, want := range cases {
		assert.Contains(t, why[hashOf(q)], want, q)
	}
}

func TestAKeyMustBeTheTextsHash(t *testing.T) {
	q := `query G { myTasks { nextCursor } }`
	raw, _ := json.Marshal(map[string]string{strings.Repeat("0", 64): q, "XYZ": q})
	l, rejected, err := Load(raw, all)
	require.NoError(t, err)
	assert.Equal(t, 0, l.Len())
	require.Len(t, rejected, 2)
	_, _, err = Load([]byte(`["not an object"]`), all)
	assert.Error(t, err)
}

// TestTheCost: a field that reads an owner costs CallCost, any other field with a selection ObjectCost, leaves
// nothing; aliases are counted (BM03).
func TestTheCost(t *testing.T) {
	schema, err := Schema(all)
	require.NoError(t, err)
	measure := func(q string) *walk {
		doc, gerrs := gqlparser.LoadQuery(schema, q)
		require.Empty(t, gerrs, q)
		w := &walk{doc: doc}
		w.selections(doc.Operations[0].SelectionSet, 1)
		return w
	}
	// myTasks 10 + items 1 + summary 1 + fields 1 + action 1
	assert.Equal(t, 14, measure(`{ myTasks { items { id summary { title fields { key } } action { path } } nextCursor } }`).cost)
	// product 10 + stock 10 + warehouse 1
	assert.Equal(t, 21, measure(`{ product(id: "1") { id stock { warehouse { name } available } } }`).cost)
	// fragments count as written in place
	assert.Equal(t, 21, measure(`{ product(id: "1") { ...P } } fragment P on ProductDetail { stock { warehouse { name } } }`).cost)
	w := measure(`{ a: product(id: "1") { id } b: product(id: "2") { id } product(id: "3") { id } }`)
	assert.Equal(t, 2, w.aliases)
	assert.Equal(t, 30, w.cost)
	ten := ""
	for _, a := range "abcdefghij" {
		ten += string(a) + `: product(id: "1") { stock { warehouse { id } } } `
	}
	_, why := load(t, all, "{ "+ten+"}")
	assert.Contains(t, why[hashOf("{ "+ten+"}")], "cost 210 over 200")
}

// TestTheDepth: measured through fragments, against a schema deep enough to pass the limit.
func TestTheDepth(t *testing.T) {
	deep := gqlparser.MustLoadSchema(&ast.Source{Input: `type Query { n: N } type N { n: N v: Int }`})
	q := `{ n { n { n { n { n { ...F } } } } } } fragment F on N { n { v } }`
	_, why := take(deep, hashOf(q), q)
	assert.Contains(t, why, "depth 7 over 6")
	q6 := `{ n { n { n { n { n { v } } } } } }`
	_, why = take(deep, hashOf(q6), q6)
	assert.Empty(t, why)
}

// TestTheRuntimeLimits: a variable passed as a limit is checked as given; absent, it takes the default.
func TestTheRuntimeLimits(t *testing.T) {
	q := `query G($l: Int, $c: String) { myTasks(limit: $l, cursor: $c) { nextCursor } }`
	l, _ := load(t, all, q)
	h := hashOf(q)
	assert.Empty(t, l.Limits(h, map[string]any{}))
	assert.Empty(t, l.Limits(h, map[string]any{"l": int64(50)}))
	assert.Empty(t, l.Limits(h, map[string]any{"l": json.Number("1")}))
	for _, bad := range []any{int64(51), int64(0), json.Number("200"), 1.5} {
		v := l.Limits(h, map[string]any{"l": bad})
		require.Len(t, v, 1, "%v", bad)
		assert.Equal(t, "variables.l", v[0].Field)
	}
}
