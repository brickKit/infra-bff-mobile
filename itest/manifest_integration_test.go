//go:build integration

package itest

import (
	"strings"

	"github.com/stretchr/testify/assert"
)

// manifest: the entries that do not pass are refused one by one at start and logged, the member starts anyway
// (BM02); the logs never hold a query's variables or the caller's credential (BM11).
func (fx *fixture) manifest() {
	t := fx.t
	logs := fx.logs.String()
	refusedLogged := func(hash string) bool {
		for _, line := range strings.Split(logs, "\n") {
			if strings.Contains(line, "bff_query_rejected") && strings.Contains(line, hash) {
				return true
			}
		}
		return false
	}
	for name, q := range refused {
		h := hashOf(q)
		assert.True(t, refusedLogged(h), "%s is not logged as refused", name)
		a := fx.carol.byHash(h, nil)
		assert.Equal(t, 400, a.Status, "%s: %s", name, a.Raw)
		assert.Equal(t, "PERSISTED_QUERY_NOT_FOUND", a.Prob["reason"], name)
	}
	assert.True(t, refusedLogged(wrongHash), "the entry under a wrong hash is not logged as refused")
	for _, name := range []string{"homeWithOpps", "opportunities", "product"} {
		assert.True(t, refusedLogged(hashOf(queries[name])), "%s is not logged as refused by the smaller deployment", name)
	}
	assert.NotContains(t, logs, "bolt-secret-term", "a variable was logged")
	assert.NotContains(t, logs, fx.w.Token(carol), "the caller's credential was logged")
}
