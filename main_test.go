package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCheckManifest: the build's check fails on any entry that does not pass, and on a file that is not a list.
func TestCheckManifest(t *testing.T) {
	write := func(texts ...string) string {
		m := map[string]string{}
		for _, q := range texts {
			s := sha256.Sum256([]byte(q))
			m[hex.EncodeToString(s[:])] = q
		}
		raw, err := json.Marshal(m)
		require.NoError(t, err)
		p := filepath.Join(t.TempDir(), "list.json")
		require.NoError(t, os.WriteFile(p, raw, 0o600))
		return p
	}
	good := `query G { myOpportunities { nextCursor } }`
	assert.Equal(t, 0, checkManifest(write(good)))
	assert.Equal(t, 1, checkManifest(write(good, `query B { nope }`)))
	bad := filepath.Join(t.TempDir(), "bad.json")
	require.NoError(t, os.WriteFile(bad, []byte("[]"), 0o600))
	assert.Equal(t, 1, checkManifest(bad))
	assert.Equal(t, 2, checkManifest(filepath.Join(t.TempDir(), "missing.json")))
}
