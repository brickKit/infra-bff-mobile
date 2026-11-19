package graph

import "github.com/vektah/gqlparser/v2/ast"

// Sources is the schema's source as generated from contract/schema.graphql: the persisted query list is checked
// against a copy loaded from it, without the absent owners' fields (BM07).
func Sources() []*ast.Source { return sources }
