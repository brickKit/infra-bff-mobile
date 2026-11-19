//go:build integration

package itest

// The mobile aggregation over its real surface (L2), against stand-ins of the owners it reads: each stand-in is an
// HTTP server answering the owner's published contract (its contract/openapi.yaml, not its code), recording what it
// was asked and with which credential, and able to be slow or to refuse. No database and no bus: the component has
// neither. The member listens on 28500; a second member without crm/opportunity and erp/inventory on 28509.
// Run: go test -tags integration ./itest/ (make test-integration); the index of the steps is itest/AGENTS.md.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	bffmobile "github.com/brickKit/infra-bff-mobile/v3/bffmobile"
	core "github.com/brickKit/infra-bff-mobile/v3/internal/core"

	sdkauthz "github.com/brickKit/be-sdk-go/v3/authz"
	"github.com/brickKit/be-sdk-go/v3/config"
	"github.com/brickKit/be-sdk-go/v3/launcher"
	"github.com/brickKit/be-sdk-go/v3/runtime"
	"github.com/brickKit/be-sdk-go/v3/sectest"
	"github.com/stretchr/testify/require"
)

const (
	itPort      = "28500"
	itBase      = "http://localhost:" + itPort
	itPortFew   = "28509" // the member of a deployment without crm/opportunity and erp/inventory
	itBaseFew   = "http://localhost:" + itPortFew
	carol       = "0190f3a1-0000-7000-8000-0000000000c3" // uses the entry
	dave        = "0190f3a1-0000-7000-8000-0000000000d4" // no grant at all
	purchaseTsk = "0190f3a1-0000-7000-8000-00000000a001"
)

// fixture is the running members, the stand-ins and the persisted queries, shared by the steps.
type fixture struct {
	t      *testing.T
	ctx    context.Context
	w      *sectest.World
	owners map[string]*standIn
	logs   *lockedBuffer // both members' logs
	carol  client
	dave   client
	few    client // Carol on the member without crm/opportunity and erp/inventory
}

func TestBffMobileEndToEnd(t *testing.T) {
	fx := start(t)
	fx.entry()
	fx.reads()
	fx.missing()
	fx.manifest()
}

func start(t *testing.T) *fixture {
	ctx := context.Background()
	w := sectest.New(t)
	use := sdkauthz.Segment{ResourceType: core.Entry, Operation: core.OpEntry, Atoms: map[string]sdkauthz.Atom{},
		Valid: sdkauthz.Window{From: "2026-01-01T00:00:00Z"}}
	w.Grant(carol, use)
	fx := &fixture{t: t, ctx: ctx, w: w, owners: map[string]*standIn{}, logs: &lockedBuffer{}}
	portFree(t, itPort, itPortFew)
	for _, id := range core.Owners {
		fx.owners[id] = newStandIn(t, id)
	}
	t.Cleanup(func() {
		if t.Failed() {
			t.Log(fx.logs.String())
		}
	})
	list := persisted(t)
	fx.run(itPort, list, core.Owners)
	fx.run(itPortFew, list, []string{core.Workflow, core.Notification, core.Product, core.Partner, core.Sales})
	fx.carol = client{t, itBase, w.Bearer(carol)}
	fx.dave = client{t, itBase, w.Bearer(dave)}
	fx.few = client{t, itBaseFew, w.Bearer(carol)}
	return fx
}

// run starts one member with the persisted query file and the addresses of the given owners only.
func (fx *fixture) run(port, list string, owners []string) {
	t := fx.t
	env := fx.w.Env(t, core.ID)
	for k, v := range map[string]string{"COMPONENT_ID": core.ID, "COMPONENT_VERSION": bffmobile.Version, "PORT": port,
		"STOP_DRAIN_DELAY": "50ms", core.KeyQueries + "_FILE": list} {
		env[k] = v
	}
	for _, id := range owners {
		env[runtime.EnvPrefix(id)+"_ENDPOINT"] = fx.owners[id].srv.URL
	}
	opts := launcher.Options{Stdout: fx.logs, Stderr: fx.logs,
		Env: config.Env{LookupEnv: func(k string) (string, bool) { v, ok := env[k]; return v, ok }, Read: os.ReadFile}}
	sctx, stop := context.WithCancel(fx.ctx)
	done := make(chan int, 1)
	go func() { done <- launcher.Run(sctx, bffmobile.Definition(), opts) }()
	t.Cleanup(func() { stop(); <-done })
	require.Eventually(t, func() bool {
		r, err := http.Get("http://localhost:" + port + "/readyz")
		if err == nil {
			r.Body.Close()
		}
		return err == nil && r.StatusCode == 200
	}, 20*time.Second, 100*time.Millisecond, "the member on %s did not become ready", port)
}

// --- the persisted queries: the mobile entry's build would produce this list ---

// The queries the steps send, by name. Each is listed under its SHA-256.
var queries = map[string]string{
	"home": `query Home($limit: Int) {
  myTasks(limit: $limit) { items { id component taskType state version dueAt stale receivedAt
      summary { title fields { key label value } } action { component path } } nextCursor }
  myNotifications(unread: true, limit: 5) { items { id sender category title link template params createdAt readAt withdrawn } unread nextCursor }
}`,
	"tasks":   `query Tasks($cursor: String, $limit: Int) { myTasks(cursor: $cursor, limit: $limit) { items { id } nextCursor } }`,
	"task":    `query Task($component: String!, $id: ID!) { task(component: $component, id: $id) { id component action { component path } summary { title } } }`,
	"product": `query Product($id: ID!) { product(id: $id) { id code name names baseUnit state masked stock { warehouse { id code name } onHand reserved available } } }`,
	"productBare": `query ProductBare($id: ID!) { product(id: $id) { id code name } }`,
	"twoProducts": `query TwoProducts($a: ID!, $b: ID!) { a: product(id: $a) { id stock { warehouse { name } available } }
  b: product(id: $b) { id stock { warehouse { name } available } } }`,
	"products":  `query Products($q: String) { products(q: $q, limit: 10) { items { id code kind name names baseUnit state masked } nextCursor } }`,
	"customers": `query Customers($le: ID, $q: String) { customers(legalEntityId: $le, q: $q) { items { id kind name names country taxId state masked } nextCursor } }`,
	"customer":  `query Customer($id: ID!) { customer(id: $id) { id name } }`,
	"orders": `query Orders($state: String, $cursor: String) { myOrders(state: $state, cursor: $cursor, limit: 10) {
  items { id number legalEntityId customer { partnerId name } currency state businessDate total updatedAt masked } nextCursor } }`,
	"order":         `query Order($id: ID!) { order(id: $id) { id number total } }`,
	"opportunities": `query Opps { myOpportunities(stage: "proposal") { items { id number name customer { partnerId name } currency amount stage probability expectedCloseDate updatedAt masked } nextCursor } }`,
	"opportunity":   `query Opp($id: ID!) { opportunity(id: $id) { id name } }`,
	"homeWithOpps":  `query HomeWithOpps { myTasks { items { id } nextCursor } myOpportunities { items { id } nextCursor } }`,
}

// The entries the member must refuse at start (BM02, BM03), each for the reason named.
var refused = map[string]string{
	"mutation":      `mutation M { myTasks { nextCursor } }`,
	"subscription":  `subscription S { myTasks { nextCursor } }`,
	"introspection": `query I { __schema { types { name } } }`,
	"unknownField":  `query U { myTasks { items { secret } } }`,
	"literalLimit":  `query L { myTasks(limit: 100) { nextCursor } }`,
	"aliases": `query A { a1: customer(id: "1") { id } a2: customer(id: "2") { id } a3: customer(id: "3") { id }
  a4: customer(id: "4") { id } a5: customer(id: "5") { id } a6: customer(id: "6") { id } a7: customer(id: "7") { id }
  a8: customer(id: "8") { id } a9: customer(id: "9") { id } a10: customer(id: "10") { id } a11: customer(id: "11") { id } }`,
	"cost": `query C { a: product(id: "1") { stock { warehouse { id } } } b: product(id: "2") { stock { warehouse { id } } }
  c: product(id: "3") { stock { warehouse { id } } } d: product(id: "4") { stock { warehouse { id } } }
  e: product(id: "5") { stock { warehouse { id } } } f: product(id: "6") { stock { warehouse { id } } }
  g: product(id: "7") { stock { warehouse { id } } } h: product(id: "8") { stock { warehouse { id } } }
  i: product(id: "9") { stock { warehouse { id } } } j: product(id: "10") { stock { warehouse { id } } } }`,
	"twoOperations": `query One { myTasks { nextCursor } } query Two { myOrders { nextCursor } }`,
}

const wrongHash = "0000000000000000000000000000000000000000000000000000000000000000"

func hashOf(q string) string { s := sha256.Sum256([]byte(q)); return hex.EncodeToString(s[:]) }

// persisted writes the list (every query and every refused entry, plus one listed under a hash that is not its
// text's) and returns its path.
func persisted(t *testing.T) string {
	list := map[string]string{}
	for _, q := range queries {
		list[hashOf(q)] = q
	}
	for _, q := range refused {
		list[hashOf(q)] = q
	}
	list[wrongHash] = queries["tasks"]
	raw, err := json.Marshal(list)
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "persisted-queries.json")
	require.NoError(t, os.WriteFile(path, raw, 0o600))
	return path
}

// --- the stand-ins of the owners ---

// seen is one request a stand-in answered.
type seen struct {
	Method, Path, Auth string
}

type standIn struct {
	id  string
	srv *httptest.Server
	mu  sync.Mutex
	got []seen
	// answer replaces the stand-in's contract answers while set (a slow or refusing owner).
	answer func(w http.ResponseWriter, r *http.Request) bool
}

func newStandIn(t *testing.T, id string) *standIn {
	s := &standIn{id: id}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.got = append(s.got, seen{Method: r.Method, Path: r.URL.RequestURI(), Auth: r.Header.Get("Authorization")})
		answer := s.answer
		s.mu.Unlock()
		if answer != nil && answer(w, r) {
			return
		}
		ownerAnswer(s.id, w, r)
	}))
	t.Cleanup(s.srv.Close)
	return s
}

// requests returns what the stand-in was asked since the last call, and forgets it.
func (s *standIn) requests() []seen {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.got
	s.got = nil
	return out
}

func (s *standIn) set(answer func(w http.ResponseWriter, r *http.Request) bool) {
	s.mu.Lock()
	s.answer = answer
	s.mu.Unlock()
}

func (fx *fixture) forget() {
	for _, s := range fx.owners {
		s.requests()
		s.set(nil)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func problem(w http.ResponseWriter, status int, domain, reason string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": reason, "status": status,
		"reason": reason, "domain": domain, "detail": "internal detail of " + domain + ": table x, row y"})
}

// --- client ---

type client struct {
	t    *testing.T
	base string
	auth string
}

// answer is the route's answer: the status, the GraphQL body or the problem.
type answer struct {
	Status int
	Data   map[string]any
	Errors []gqlError
	Prob   map[string]any
	Raw    string
}

type gqlError struct {
	Message    string         `json:"message"`
	Path       []any          `json:"path"`
	Extensions map[string]any `json:"extensions"`
}

// query sends a persisted query by its name.
func (c client) query(name string, vars map[string]any) answer {
	c.t.Helper()
	q, ok := queries[name]
	require.True(c.t, ok, name)
	return c.byHash(hashOf(q), vars)
}

func (c client) byHash(hash string, vars map[string]any) answer {
	c.t.Helper()
	body := map[string]any{"extensions": map[string]any{"persistedQuery": map[string]any{"version": 1, "sha256Hash": hash}}}
	if vars != nil {
		body["variables"] = vars
	}
	return c.post(body)
}

func (c client) post(body any) answer {
	c.t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(c.t, err)
	req, err := http.NewRequest("POST", c.base+bffmobile.Path, bytes.NewReader(raw))
	require.NoError(c.t, err)
	req.Header.Set("Content-Type", "application/json")
	if c.auth != "" {
		req.Header.Set("Authorization", c.auth)
	}
	resp, err := http.DefaultClient.Do(req)
	require.NoError(c.t, err)
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	a := answer{Status: resp.StatusCode, Raw: string(b)}
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "application/problem+json") {
		require.NoError(c.t, json.Unmarshal(b, &a.Prob), string(b))
		return a
	}
	var g struct {
		Data   map[string]any `json:"data"`
		Errors []gqlError     `json:"errors"`
	}
	require.NoError(c.t, json.Unmarshal(b, &g), string(b))
	a.Data, a.Errors = g.Data, g.Errors
	return a
}

// errorAt returns the GraphQL error whose path starts with the given segments.
func (a answer) errorAt(path ...any) (gqlError, bool) {
	for _, e := range a.Errors {
		if len(e.Path) < len(path) {
			continue
		}
		match := true
		for i, p := range path {
			if e.Path[i] != p {
				match = false
			}
		}
		if match {
			return e, true
		}
	}
	return gqlError{}, false
}

// --- helpers ---

type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) { l.mu.Lock(); defer l.mu.Unlock(); return l.b.Write(p) }
func (l *lockedBuffer) String() string             { l.mu.Lock(); defer l.mu.Unlock(); return l.b.String() }

func portFree(t *testing.T, ports ...string) {
	for _, p := range ports {
		l, err := net.Listen("tcp", ":"+p)
		require.NoError(t, err, "port %s is taken", p)
		l.Close()
	}
}
