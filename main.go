// Command infra-bff-mobile runs the mobile aggregation alone (serve); check-manifest <file> checks a persisted query
// list against the full schema for the mobile entry's build (BM02). The shells compile in bffmobile.Definition().
package main

import (
	"fmt"
	"os"

	"github.com/brickKit/be-sdk-go/v3/launcher"
	"github.com/brickKit/infra-bff-mobile/v3/bffmobile"
	"github.com/brickKit/infra-bff-mobile/v3/internal/queries"
)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "check-manifest" {
		os.Exit(checkManifest(os.Args[2]))
	}
	launcher.Main(bffmobile.Definition())
}

func checkManifest(path string) int {
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	rejected, err := queries.Check(raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, r := range rejected {
		fmt.Fprintf(os.Stderr, "%s: %s\n", r.Hash, r.Why)
	}
	if len(rejected) > 0 {
		return 1
	}
	return 0
}
