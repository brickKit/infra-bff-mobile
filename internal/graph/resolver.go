package graph

import reads "github.com/brickKit/infra-bff-mobile/v3/internal/reads"

// Resolver resolves the schema's fields through the reads of the owners (internal/reads); the resolvers themselves
// only pass arguments on.
type Resolver struct {
	Reads *reads.Reads
}
