// Package entry is the one route (BM01): the entry operation, the persisted query and the limits, then the execution
// with gqlgen's executor only (BM08), its errors as be-protocol P3.3's extensions (BM06, BM09), and the per-field
// metrics and spans (BM11).
package entry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"
	graph "github.com/brickKit/infra-bff-mobile/v3/internal/graph"
	queries "github.com/brickKit/infra-bff-mobile/v3/internal/queries"
	reads "github.com/brickKit/infra-bff-mobile/v3/internal/reads"

	"github.com/99designs/gqlgen/graphql"
	"github.com/99designs/gqlgen/graphql/executor"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/brickKit/be-sdk-go/v3/authz"
	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/brickKit/be-sdk-go/v3/httpx"
	"github.com/brickKit/be-sdk-go/v3/runtime"
	"github.com/vektah/gqlparser/v2/ast"
)

// ErrNotFound is the answer for a hash that is not in the deployment's list (BM02).
var ErrNotFound = errs.Define(core.Domain, "PERSISTED_QUERY_NOT_FOUND", errs.InvalidArgument, 400, errs.RetryNo,
	"The persisted query is not known")

// Entry serves the route.
type Entry struct {
	rt   *runtime.Runtime
	list *queries.List
	exec *executor.Executor
	m    *metrics
}

// New builds the entry: the owners the deployment has, the persisted queries taken against the schema without the
// others (each refused entry logged), and the executor.
func New(rt *runtime.Runtime) (*Entry, error) {
	m, err := newMetrics(rt)
	if err != nil {
		return nil, err
	}
	b := core.NewBase(rt)
	e := &Entry{rt: rt, m: m, list: load(rt, b, m)}
	e.exec = executor.New(graph.NewExecutableSchema(graph.Config{Resolvers: &graph.Resolver{Reads: reads.New(b)}}))
	e.exec.SetQueryCache(lru.New[*ast.QueryDocument](max(e.list.Len(), 1)))
	e.exec.SetErrorPresenter(e.present)
	e.exec.SetRecoverFunc(e.recover)
	e.exec.AroundRootFields(e.rootField)
	return e, nil
}

// load reads the persisted queries (BM02): no list, or one that is not a JSON object, refuses every query and the
// member starts; a BFF_PERSISTED_QUERIES_FILE that cannot be read is a configuration problem the SDK stops the start
// on (a shell too), like any other.
func load(rt *runtime.Runtime, b *core.Base, m *metrics) *queries.List {
	empty, _, _ := queries.Load([]byte("{}"), b.Has)
	secret := rt.Config.Secret(core.KeyQueries)
	if secret == nil {
		rt.Logger.Warn("no persisted queries: every query is refused", "event", "bff_queries_absent")
		return empty
	}
	list, rejected, err := queries.Load([]byte(secret.Value()), b.Has)
	if err != nil {
		rt.Logger.Error("the persisted queries cannot be read: every query is refused", "event", "bff_queries_unreadable",
			"error", err.Error())
		return empty
	}
	for _, r := range rejected {
		rt.Logger.Warn("a persisted query is refused", "event", "bff_query_rejected", "hash", r.Hash, "why", r.Why)
		m.rejected.Inc()
	}
	rt.Logger.Info("persisted queries taken", "event", "bff_queries_taken", "taken", list.Len(), "refused", len(rejected))
	return list
}

// body is the request (BM01): a persisted query by its hash, never the text.
type body struct {
	OperationName string         `json:"operationName"`
	Variables     map[string]any `json:"variables"`
	Extensions    struct {
		PersistedQuery *struct {
			Version    int    `json:"version"`
			SHA256Hash string `json:"sha256Hash"`
		} `json:"persistedQuery"`
	} `json:"extensions"`
}

type traceKey struct{}
type hashKey struct{}

// Serve answers one request: the entry operation first, nothing called without it.
func (e *Entry) Serve(c *httpx.Context) error {
	ctx := c.Ctx()
	s, ok := authz.From(ctx)
	if !ok {
		return errs.New(errs.ReasonInternal, "no subject on a protected route")
	}
	if _, _, err := s.Check(ctx, core.OpEntry, authz.Facts{}); err != nil {
		if errs.From(err).Reason == errs.ReasonNotFound { // the entry has no record: not visible is not granted
			return errs.New(errs.ReasonPermissionDenied, "the mobile entry is not granted")
		}
		return err
	}
	var b body
	if err := strictJSON(c, &b); err != nil {
		return err
	}
	pq := b.Extensions.PersistedQuery
	if pq == nil || pq.Version != 1 || !hashForm(pq.SHA256Hash) {
		return errs.New(errs.ReasonRequestInvalid, "a persisted query by its SHA-256 is required").WithViolations(
			errs.Violation{Field: "extensions.persistedQuery", Reason: "required",
				Description: "version 1 and a lower-case hex sha256Hash"})
	}
	text, ok := e.list.Query(pq.SHA256Hash)
	if !ok {
		return ErrNotFound.New("the hash is not in the deployment's list")
	}
	ctx = context.WithValue(ctx, traceKey{}, c.TraceID())
	ctx = context.WithValue(ctx, hashKey{}, pq.SHA256Hash)
	ctx = reads.WithRequest(graphql.StartOperationTrace(ctx))
	op, gerrs := e.exec.CreateOperationContext(ctx, &graphql.RawParams{Query: text, OperationName: b.OperationName,
		Variables: b.Variables})
	if len(gerrs) > 0 {
		v := make([]errs.Violation, 0, len(gerrs))
		for _, g := range gerrs {
			v = append(v, errs.Violation{Field: "variables", Reason: "invalid", Description: g.Message})
		}
		return errs.New(errs.ReasonRequestInvalid, "the variables do not fit the query").WithViolations(v...)
	}
	if v := e.list.Limits(pq.SHA256Hash, op.Variables); len(v) > 0 {
		return errs.New(errs.ReasonRequestInvalid, "a limit is out of range").WithViolations(v...)
	}
	handler, ctx := e.exec.DispatchOperation(ctx, op)
	resp := handler(ctx)
	if resp == nil {
		return errs.New(errs.ReasonDeadlineExceeded, "the request ended before the answer")
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return errs.From(err)
	}
	return c.Bytes(200, "application/json", raw)
}

// strictJSON binds the body, refusing unknown members (the query text is one).
func strictJSON(c *httpx.Context, v any) error {
	raw, err := c.Body()
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	dec.UseNumber() // numbers stay exact: gqlgen coerces an Int from json.Number, never from float64
	if err := dec.Decode(v); err != nil {
		return errs.New(errs.ReasonRequestInvalid, "the body is not a persisted query request").WithViolations(
			errs.Violation{Field: "body", Reason: "invalid", Description: "operationName, variables and extensions only"})
	}
	return nil
}

func hashForm(h string) bool {
	if len(h) != 64 {
		return false
	}
	for _, r := range h {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func (e *Entry) recover(ctx context.Context, p any) error {
	e.rt.Logger.Error("a resolver panicked", "event", "bff_panic", "panic", fmt.Sprint(p))
	return errs.New(errs.ReasonInternal, "a resolver panicked")
}
