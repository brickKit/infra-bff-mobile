package entry

import (
	"context"
	"errors"
	"math"

	"github.com/99designs/gqlgen/graphql"
	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

// present turns a field's error into be-protocol P3.3's extensions (BM06): reason, domain, metadata (the owner in
// metadata.dependency), the trace and, for a retryable reason, retry_after in seconds. The owner's detail never
// passes (BM09); an own failure is logged with its cause and shown as INTERNAL.
func (e *Entry) present(ctx context.Context, err error) *gqlerror.Error {
	g := graphql.DefaultErrorPresenter(ctx, err)
	var own *errs.Error
	if !errors.As(err, &own) {
		own = errs.New(errs.ReasonInternal, "")
	}
	if own.Reason == errs.ReasonInternal {
		e.rt.Logger.ErrorContext(ctx, "a field failed", "event", "bff_field_failed", "path", g.Path.String(),
			"error", err.Error())
	}
	// the message is the catalog's title for a platform reason, the reason itself otherwise: never an owner's own
	// wording (BM09)
	title := own.Reason
	if entry, ok := errs.Platform(own.Reason); ok && own.Domain == errs.PlatformDomain {
		title = entry.Title
	}
	ext := map[string]any{"reason": own.Reason, "domain": own.Domain}
	if len(own.Metadata) > 0 {
		ext["metadata"] = own.Metadata
	}
	if trace, _ := ctx.Value(traceKey{}).(string); trace != "" {
		ext["trace_id"] = trace
	}
	if s := retryAfter(own); s > 0 {
		ext["retry_after"] = s
	}
	return &gqlerror.Error{Message: title, Path: g.Path, Locations: g.Locations, Extensions: ext}
}

// retryAfter is the seconds to wait before retrying: the owner's or the SDK's when given, else one second for a
// platform reason the catalog marks retryable or "query first" (every field here is a read: the query is the retry);
// an owner's own reason never is; 0: not retryable.
func retryAfter(e *errs.Error) int {
	if e.RetryAfter > 0 {
		return int(math.Ceil(e.RetryAfter.Seconds()))
	}
	if entry, ok := errs.Platform(e.Reason); ok && e.Domain == errs.PlatformDomain &&
		(entry.Retry == errs.RetryYes || entry.Retry == errs.RetryQueryFirst) {
		return 1
	}
	return 0
}
