# Precedent injection — siblings as a codegraph query

Autonomous build, 2026-08-18. Follows the review published as
`~/sr-docs/explainers/2026-08-18-precedent-injection.html`.

## The problem, measured

A repo-mode build receives ~19,000 characters of context and **none of it is code
from this repository**: 5,579 of system prompt, ≤8,000 of codebase digest (signature
lines), ~4,900 of codegraph (prose and paths), 709 of design rules.

The prompt tells the agent to "read two existing files of the same shape and copy
their structure, naming, error handling and helpers", then leaves it to find them.
Across 275 production repo iterations that costs:

| | |
|---|---|
| discovery actions (read/grep/find/ls) | 2,797 of 5,546 — **50.4%** |
| edits and writes | 764 — 13.8% |
| reads per distinct file | **6.45** (2,342 reads over 363 files) |
| files read across 7+ unrelated builds | `registry-internal.ts`, `registry.ts` — registries and canonical exemplars |

Files read by one build are its task. Files read by eight unrelated builds are
precedent lookups the system could have answered before the agent spent a turn.

## Why this is a codegraph query and not a parallel picker

Considered building the picker beside the codebase digest, since precedent is a
property of the tree and the graph is a record of history. Rejected, on two
arguments:

- **Forgetting.** `retrieve.ts` is the one loader, which is what makes retirement
  and edge suppression enforceable. A second picker cannot be told to forget, and
  today nothing at all can express "never hold this file up as an example".
- **Ranking.** "Which of 358 `+server.ts` files is canonical here" is a ranking
  question. The graph already holds import centrality across the whole tree plus
  `episodeCount`/`lessonCount` per node. A local scan has none of it.

The freshness objection was really an objection to how the node table is populated,
which this spec fixes. The resulting split:

> **codegraph picks the paths. The executor reads the bytes from the build's own
> workspace.** The graph stores no source and never will; a path the build's clone
> lacks simply drops out of the injection.

## What ships

### 1. Gate failures become fingerprintable

The hot lane has never fired: all 16 production push serves used the file lane and
`served_for` is `[]` on every row. `extractDiagnostics` summarises a failed gate as
a stage name — ``The gate failed in `gate:sync`.`` — and `fingerprintsIn` can only
key on an error *class*, so it returns nothing. Verified on build `42244cc0`: eight
consecutive iterations after a failed gate, none fingerprinted.

Add `gate:<stage>-failed` as the last-resort class, below every sharper key. Low
cardinality, stable across runs, and it makes every gate failure attributable —
without which `resolveBuildServes` has nothing to resolve and outcome ranking can
never leave its recency regime.

Also: **ANSI arrives half-stripped.** Of 827 build error logs, zero contain an
escape byte and 42 contain bare `[31m`-style codes — something upstream removes the
escape and leaves the rest, so a failure keys as `gate:1mError`. Strip orphaned SGR
sequences too, narrowly (`[` digits `m` only).

### 2. `family` as a node attribute, and a `siblings:` seed

The graph has no notion of "same kind of file". An edge kind would be a disaster —
358 route handlers is 63,903 pairs against the 6,681 `imports` edges that exist
today — so family is a **derived node attribute**, O(n), computed from the path at
ingest with no LLM.

```
siblings:src/routes/api/jkai/x/+server.ts | limit 2
```

Ranked: same directory, then same family, then import in-degree (a file many others
import is the one that set the convention), then episode+lesson count, then path.
Resolved through `runPlan`, so `nodeVisible()` and edge suppression apply and
forgetting stays enforceable in exactly one place.

### 3. Node freshness, fixed at the source

216 file nodes are flagged absent from the tree and **138 of them are on master** —
a 64% false-positive rate, including codegraph's own `auth.ts`. `headFileSet()`
stamps liveness from `git ls-files` in homeserv's main checkout, which sits on a
branch predating codegraph. The sentinel cannot catch it: `package.json` and
`schema.ts` exist on every branch.

Split the backfill by data source. The tree-derived half — nodes, `family`,
`imports`/`tests` edges, liveness — needs only the tree, so it runs as
`scripts/codegraph-tree-pass.mjs` in the **release job**, which is a self-hosted
runner on the VPS holding a git checkout detached at the deployed SHA, beside a
`.env` that already has `CLAUDE_CHANGELOG_SECRET`. The ref is then correct by
construction and a file becomes a node the moment it lands. The history half
(episodes, lessons) stays on homeserv where the transcripts are.

### 4. The precedent channel

In `executor.ts`, beside the codegraph push: resolve the build's target files, ask
the graph for their siblings, read those files **from the build's workspace**, and
inject a bounded skeleton of each under its own heading. Its own kill switch
(`CODEGRAPH_PRECEDENT=0`), its own `codegraph_queries` row (`channel='precedent'`),
so it can be switched off and A/B'd independently of the push.

Budget comes **out of** the digest, not on top of it: a 60-file signature index is
mostly noise for a task touching three files.

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Where siblings are picked | beside the digest / inside codegraph | **inside codegraph** | forgetting is enforceable in one loader; the graph holds the ranking signal | yes — the picker is one module |
| Family representation | `sibling_of` edges / node attribute | **node attribute** | edges would add >100k rows for a relation that is a pure function of the path | yes — column is additive |
| Where source comes from | graph / build workspace | **workspace** | the graph stores no source; a stale path must not be injected | n/a |
| Tree pass host | GitHub-hosted CI / VPS release job / homeserv timer | **VPS release job** | needs no new GitHub secret, and the checkout is the deployed SHA by construction | yes — script runs anywhere with a token |
| Gate-stage key shape | drop it / `gate:<stage>-failed` | **`gate:<stage>-failed`** | five stable values; without it no gate failure is ever attributable | yes |
| Digest budget | add on top / take from digest | **take from digest** | total context is already ~19KB and the digest tail is the least relevant part | yes — one constant |
| Pattern linter (review step 4) | include / defer | **defer** | John: "I'm ok with the others being separate" | n/a |

## Verification

- `npx vitest run src/lib/codegraph/` and the full gate.
- Fingerprint tests pinned against the **real production strings** pulled from
  `jkai_logs`, not invented ones.
- Post-deploy, live: `codegraph-query.mjs 'siblings:…'` returns ranked siblings;
  `codegraph_nodes.family` is populated; `exists_on_head` false-positives drop from
  138 to 0.
- Primary metric is discovery cost — 10.2 discovery actions per iteration and 6.45
  reads per distinct file — not iterations-to-green. The top build failures today
  are environmental (`Cannot find module` 48, provider overload 35, missing
  playwright 28, missing ripgrep 24) and no amount of precedent will move them.
