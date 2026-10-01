#!/usr/bin/env bash
# The database contracts: integration tests the merge gate DOES run, against a
# real Postgres, outside the ordinary `--exclude '**/*.integration.test.ts'`
# suite.
#
# One script, two callers, so the list cannot drift between them:
#   .github/workflows/ci.yml       `Memory and evidence database contracts`
#                                  (test shard 1, after the main suite)
#   development-workspace-broker   verifyRuntime, in the preview container
#                                  against its disposable pgvector database
# Before this file the broker ran neither, so a /jkai/develop candidate that
# broke either contract passed isolated verification and went red in CI.
#
# Both need only DATABASE_URL with the schema pushed — no loopback host, no
# fixed database name (contrast src/lib/home/presence/feed-checks.test.ts) —
# so the preview database at `<name>-db:5432/preview` runs them faithfully.
#
# --no-file-parallelism: consolidation scans pending memories, so another file
# inserting or deleting memory fixtures during that scan breaks it.
#
# src/lib/jkai/memory/service.integration.test.ts was on this list until it left
# Main with the JKAI source (#997). vitest runs whatever matches ANY filter and
# silently drops one that matches nothing, so CI kept naming a missing file.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec npx --no-install vitest run --no-file-parallelism \
  src/lib/jkai/grounding/evidence.integration.test.ts \
  src/lib/daydream/memory-consolidation.integration.test.ts
