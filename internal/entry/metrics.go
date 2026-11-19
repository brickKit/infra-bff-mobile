package entry

import (
	"context"
	"time"

	"github.com/99designs/gqlgen/graphql"
	"github.com/brickKit/be-sdk-go/v3/errs"
	"github.com/brickKit/be-sdk-go/v3/runtime"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/vektah/gqlparser/v2/ast"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// metrics are the member's own (BM10, BM11): per root field, the count by outcome and the time; the refused list
// entries. They are registered on the member's registry, never the default one.
type metrics struct {
	fields   *prometheus.CounterVec
	seconds  *prometheus.HistogramVec
	rejected prometheus.Counter
}

func newMetrics(rt *runtime.Runtime) (*metrics, error) {
	m := &metrics{
		fields: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "bff_mobile_field_total",
			Help: "Root fields executed, by field and outcome (ok or the failure's reason)."}, []string{"field", "outcome"}),
		seconds: prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "bff_mobile_field_seconds",
			Help: "Time of a root field, its owner's reads included.", Buckets: prometheus.DefBuckets}, []string{"field"}),
		rejected: prometheus.NewCounter(prometheus.CounterOpts{Name: "bff_mobile_query_rejected_total",
			Help: "Persisted query entries refused at start (BM02)."}),
	}
	if rt.Metrics != nil {
		for _, c := range []prometheus.Collector{m.fields, m.seconds, m.rejected} {
			if err := rt.Metrics.Register(c); err != nil {
				return nil, err
			}
		}
	}
	return m, nil
}

// rootField wraps each root field: a span tagged with the field and the query's hash, the time and the outcome.
// Variables are never recorded (BM11: they may hold search words).
func (e *Entry) rootField(ctx context.Context, next graphql.RootResolver) graphql.Marshaler {
	rf := graphql.GetRootFieldContext(ctx)
	field, alias := "", ""
	if rf != nil {
		field, alias = rf.Field.Name, rf.Field.Alias
	}
	hash, _ := ctx.Value(hashKey{}).(string)
	var span trace.Span
	if e.rt.Tracer != nil {
		ctx, span = e.rt.Tracer.Start(ctx, "bff.field "+field, trace.WithAttributes(
			attribute.String("graphql.field", field), attribute.String("bff.query_hash", hash)))
		defer span.End()
	}
	began := time.Now()
	out := next(ctx)
	e.m.seconds.WithLabelValues(field).Observe(time.Since(began).Seconds())
	// the root field's own failure only (a nested field's, the stock, is the field's partial answer); the outcome is
	// a platform reason or "owner" for an owner's own reason, so the label's values stay bounded
	outcome := "ok"
	for _, g := range graphql.GetErrors(ctx) {
		if len(g.Path) != 1 || g.Path[0] != ast.PathName(alias) {
			continue
		}
		outcome = "owner"
		if r, _ := g.Extensions["reason"].(string); g.Extensions["domain"] == errs.PlatformDomain {
			outcome = r
		}
		break
	}
	e.m.fields.WithLabelValues(field, outcome).Inc()
	return out
}
