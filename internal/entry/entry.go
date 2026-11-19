// Package entry is the one route (BM01): the entry operation, the persisted query, the limits, and the execution.
package entry

import (
	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/brickKit/be-sdk-go/v3/httpx"
	"github.com/brickKit/be-sdk-go/v3/runtime"
)

// Entry serves the route.
type Entry struct{ rt *runtime.Runtime }

// New builds the entry from the runtime.
func New(rt *runtime.Runtime) (*Entry, error) { return &Entry{rt: rt}, nil }

// Serve answers one request.
func (e *Entry) Serve(c *httpx.Context) error { return errs.New(errs.ReasonInternal, "not implemented") }
