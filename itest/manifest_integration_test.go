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
	why := func(hash string) (string, bool) {
		for _, line := range strings.Split(logs, "\n") {
			if strings.Contains(line, "bff_query_rejected") && strings.Contains(line, hash) {
				return line, true
			}
		}
		return "", false
	}
	refusedLogged := func(hash string) bool { _, ok := why(hash); return ok }
	// each entry refused for its own reason (the log's why)
	reasons := map[string]string{"mutation": "not valid", "subscription": "not valid", "introspection": "introspection",
		"unknownField": "not valid", "literalLimit": "outside 1..50", "aliases": "11 aliases over 10",
		"cost": "cost 210 over 200", "twoOperations": "2 operations"}
	for name, q := range refused {
		h := hashOf(q)
		line, ok := why(h)
		assert.True(t, ok, "%s is not logged as refused", name)
		assert.Contains(t, line, reasons[name], "%s refused for another reason", name)
		a := fx.carol.byHash(h, nil)
		assert.Equal(t, 400, a.Status, "%s: %s", name, a.Raw)
		assert.Equal(t, "PERSISTED_QUERY_NOT_FOUND", a.Prob["reason"], name)
	}
	line, _ := why(wrongHash)
	assert.Contains(t, line, "not the SHA-256", "the entry under a wrong hash")
	for _, name := range []string{"homeWithOpps", "opportunities", "product"} {
		assert.True(t, refusedLogged(hashOf(queries[name])), "%s is not logged as refused by the smaller deployment", name)
	}
	assert.NotContains(t, logs, "bolt-secret-term", "a variable was logged")
	assert.NotContains(t, logs, fx.w.Token(carol), "the caller's credential was logged")
}
