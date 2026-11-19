package core

import (
	"context"
	"net/url"

	"github.com/brickKit/be-sdk-go/v3/authz"
	"github.com/brickKit/be-sdk-go/v3/calls"
	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/brickKit/be-sdk-go/v3/runtime"
)

// Base is what the modules share: the runtime and a client of each owner the deployment has.
type Base struct {
	RT      *runtime.Runtime
	clients map[string]*calls.HTTP
}

// NewBase takes the owners the deployment has (BM07): an absent optional dependency has no address.
func NewBase(rt *runtime.Runtime) *Base {
	b := &Base{RT: rt, clients: map[string]*calls.HTTP{}}
	for _, id := range Owners {
		if c, ok := rt.HTTP(id); ok {
			b.clients[id] = c
		}
	}
	return b
}

// Has says whether the deployment has an owner.
func (b *Base) Has(owner string) bool { _, ok := b.clients[owner]; return ok }

// Get reads an owner's user surface with the caller's own credential (BM04) and decodes the answer into out. Errors
// are the SDK's as they are (P4.19): an owner's refusal unchanged, and metadata.dependency only on what the SDK names
// it for (unavailable, out of time, not sent, the credential not taken), so "none" and "not now" stay apart (BM06).
func (b *Base) Get(ctx context.Context, owner, path string, query url.Values, out any) error {
	c, ok := b.clients[owner]
	if !ok { // the field is not registered without its owner; this is a defect
		return errs.New(errs.ReasonInternal, owner+" is not in the deployment")
	}
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	return c.Do(ctx, calls.Request{Method: "GET", Path: path, ForwardUser: true}, out)
}

// Principal is the verified caller: "mine" is a filter by it, never a variable (BM04).
func Principal(ctx context.Context) (string, bool) {
	s, ok := authz.From(ctx)
	if !ok || s.Principal == "" {
		return "", false
	}
	return s.Principal, true
}
