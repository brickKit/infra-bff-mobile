// Package queries is the persisted query list (BM02) and the limits of a query (BM03).
package queries

import "errors"

// Rejected is one entry of the list that is not taken, and why.
type Rejected struct{ Hash, Why string }

// List is the persisted queries taken: query text by its SHA-256.
type List struct{ texts map[string]string }

// Load reads the list and takes the entries that pass against the schema without the owners the deployment does
// not have (BM07).
func Load(raw []byte, present func(owner string) bool) (*List, []Rejected, error) {
	return &List{texts: map[string]string{}}, nil, errors.New("not implemented")
}

// Check checks a list against the full schema (the mobile entry's build).
func Check(raw []byte) ([]Rejected, error) { return nil, errors.New("not implemented") }

// Query returns the text of a persisted query.
func (l *List) Query(hash string) (string, bool) { t, ok := l.texts[hash]; return t, ok }
