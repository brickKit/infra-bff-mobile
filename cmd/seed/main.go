// Command seed fills a running infra/bff-mobile with the seed data for people (be-assembly-standard's seed and test
// data conventions). The aggregation owns no data: what each account sees through it is what the owners grant. It
// grants, by the authorization admin, the role mobile (the entry, infra.bff_mobile.entry.use) to the seed user and to
// the accounts that use the mobile entry: the approvers (test.buyer.lead, test.finance.lead) and the salespeople
// (test.sales.cn, test.sales.multi, test.sales.es).
//
// A second run changes nothing. It waits until the grants reach the component: a query by a hash no list holds
// answers 403 without the entry and 400 PERSISTED_QUERY_NOT_FOUND with it.
//
//	SEED_IAM_URL (http://localhost:18200)    the identity member's development exchange
//	SEED_AUTHZ_URL (http://localhost:18223)  the authorization member's effect point
//	SEED_ADMIN (test.alice)                  the authorization admin (the install claim)
//	SEED_USER (test.bob), SEED_PASSWORD      the seed user; the test accounts' password
//	INFRA_BFF_MOBILE_URL (http://localhost:18500)
package main

import (
	"fmt"
	"os"
	"strings"
	"time"

	sdkauthz "github.com/brickKit/be-sdk-go/v3/authz"
	"github.com/brickKit/be-sdk-go/v3/seed"
)

const prefix = "「本地测试」"

// users are the accounts of the mobile entry.
var users = []string{"test.buyer.lead", "test.finance.lead", "test.sales.cn", "test.sales.multi", "test.sales.es"}

func main() {
	base := env("INFRA_BFF_MOBILE_URL", "http://localhost:18500")
	if !seed.Ready(base) {
		fail("infra/bff-mobile at %s is not ready", base)
	}
	pw := os.Getenv("SEED_PASSWORD")
	if pw == "" {
		fail("SEED_PASSWORD is not set (the test accounts' password in Casdoor)")
	}
	iam, user, admin := env("SEED_IAM_URL", "http://localhost:18200"), env("SEED_USER", "test.bob"), env("SEED_ADMIN", "test.alice")
	accounts, err := seed.Accounts(iam, pw, append([]string{admin, user}, users...)...)
	check(err)
	a, err := seed.NewAuthz(env("SEED_AUTHZ_URL", "http://localhost:18223"), accounts[admin].Token, "infra/bff-mobile")
	check(err)
	entry := seed.Segment("infra.bff_mobile.entry", "infra.bff_mobile.entry.use")
	entry.Atoms = map[string]sdkauthz.Atom{} // the entry has no dimension
	_, err = a.GrantRoles([]seed.RoleSpec{
		{Key: "mobile", Name: prefix + "移动入口", To: append([]string{user}, users...), Segments: []sdkauthz.Segment{entry}},
	}, accounts)
	check(err)
	probe := map[string]any{"extensions": map[string]any{"persistedQuery": map[string]any{"version": 1,
		"sha256Hash": strings.Repeat("0", 64)}}}
	for _, u := range append([]string{user}, users...) {
		code, out, err := seed.NewClient(base, accounts[u].Token).UntilGranted(time.Minute, "POST", "/api/bff-mobile/graphql", probe)
		check(err)
		if code != 400 || out["reason"] != "PERSISTED_QUERY_NOT_FOUND" {
			fail("%s's entry: %d %v", u, code, out)
		}
	}
	fmt.Printf("seed infra/bff-mobile: the mobile entry granted to %d accounts\n", len(users)+1)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "seed infra/bff-mobile: "+format+"\n", a...)
	os.Exit(1)
}

func check(err error) {
	if err != nil {
		fail("%v", err)
	}
}
