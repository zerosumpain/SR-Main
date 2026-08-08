# Smoke-testing a registered app

**Date:** 2026-08-08
**Status:** implemented
**Origin:** item 4 of the build-publish post-mortem (see PR #143 for items 1–3)

## The problem

`register_hermes_build` sets `status: 'completed'` the moment the files reach
disk. Nothing runs the app. On 2026-08-08 a heartbeat turn read that column and
told the user *"We've landed — calculator is built and published at
/projects/simple-calculator/"*. The calculator answered `0` to every sum, and
had done since the moment it was published.

Nothing in the system had lied. There was simply no step between "files written"
and "we've landed" that could have known.

## What it does

After writing the workspace, the tool opens `live/index.html` in headless
Chromium and reports back. Three baseline checks always run — loads without an
uncaught error, logs no console error, renders something — plus any behavioural
`checks` the caller supplied.

The baseline is deliberately not sufficient. Measured against the app that
started this, the broken calculator passes all three:

```
loads without an uncaught error   PASS
logs no console error             PASS
renders something                 PASS   (26 elements, 68 chars of text)
7 + 8 gives 15                    FAIL   returned false
```

Only the behavioural check catches it, and only the model that wrote the app
knows what to assert. So `checks` is described in the tool schema as strongly
recommended, with a worked example, and the failure text comes straight back in
`publishHint` for the model to iterate on.

## Decision Log

**D1 — Subprocess, not an in-process import.**
Options: import playwright in the SvelteKit server; shell out to a repo script;
use jsdom. Chose the subprocess. `playwright` is a devDependency and importing
it into the server bundle makes a production runtime dependency out of a dev
package; jsdom cannot run a canvas or a real click. Shelling out also matches
the existing precedent — `publishBuild` already runs `npm install` / `npm run
build` inside a workspace through `execInSandbox` — and puts a hung browser
behind a process timeout. *Reversible: the harness is two self-contained files.*

**D2 — Behavioural checks come from the model, not from an LLM call.**
Options: baseline only; baseline plus caller-authored assertions; generate
assertions with a separate LLM call. Chose caller-authored. Baseline alone would
have shipped the broken calculator, which is the entire point. A generation call
adds cost and latency to a tool that is meant to be cheap, to guess at an intent
the caller already holds. *Reversible: `checks` is optional.*

**D3 — A failing check does not block registration.**
Options: refuse to register; register and mark it. Chose to register and mark.
A failed build is a rescue job, not a loss — the files are worth keeping, and
refusing would push the model into workarounds. That failure mode is not
hypothetical: rejecting a well-formed `files` argument is precisely what sent
one conversation off to hand-edit a scratch file in `/tmp` that reached neither
the build nor the site. *Reversible.*

**D4 — A failing check does not block publishing either.**
Options: refuse to publish a build whose last smoke failed; warn only. Chose
warn only. The steer is `publishHint: "DO NOT publish yet"` plus the failure
list. Gating the publish would mean parsing a human-readable log line to make a
control-flow decision, which is brittle, and it would re-introduce friction into
the publish path that was just deliberately removed. *Reversible: the smoke
result is recorded, so a gate can be added later without a migration.*

**D5 — Result stored as a build log row, not a new column.**
Options: new `jkai_builds` column; a `jkai_logs` row; both. Chose the log row.
It needs no migration — and `drizzle-kit push` has twice turned a schema change
into a dead deploy, once via a TTY rename prompt, once via `.unique()` on a
populated table. The log row is already how registration writes its timeline
entry, so `/jkai/builds` renders it with no UI work. *Reversible.*

**D6 — Model-authored JS runs in the page, and that is acceptable.**
The scripts run via `page.evaluate` in a `file://` page under default Chromium
flags (no `--allow-file-access-from-files`), in a subprocess, capped at 45s.
They have no Node scope. The app's own JavaScript is already model-authored and
is published to the public internet, so the marginal trust delta is nil.

**D7 — It skips on homeserv rather than being made to work there.**
Builds on homeserv run inside the `jkai-sandbox` container, where the repo is
not mounted, so `import('playwright')` cannot resolve. Production runs with
`JKAI_BUILDS_HOSTMODE=1` on the host, where it does. Rather than mount the repo
into the container, the harness reports `ran: false` with a reason and
registration proceeds. A harness fault must never read as a failing app.
*Reversible.*

## Two things the deploy taught us afterwards

**`scripts/` is an allow-list, not a directory sync.** `ci-deploy.sh` rsyncs a
named set of runtime-read files; `scripts/server-with-ws.mjs` is listed
individually. #144 shipped the harness without adding its line, so the runner
was simply absent from the VPS and every production build reported
`skipped — playwright is not available`. CI was green throughout: the feature is
built to degrade quietly, which is correct for a missing browser and wrong for a
missing file. Fixed by adding the rsync line. **Anything new under `scripts/`
that runtime code shells out to needs its own line there.**

**Playwright's presence on the VPS is incidental.** The deploy runs
`npm install --omit=dev`, so devDependencies are never installed by it —
`playwright` and its Chromium builds are there from an earlier full install and
have survived every deploy since. Verified still resolving after today's. It was
not promoted to a production dependency on purpose: several hundred megabytes of
browser on every deploy is a poor trade for one check, and the harness already
reports `ran: false` rather than failing a build when it is missing. If it ever
does disappear, smoke checks degrade to "skipped" and say so in the build log.

## Verification

- `parseSmokeOutput` / `describeSmoke` unit-tested, including every
  harness-fault path resolving to `ran: false` and never `passed: false`
- End-to-end against both calculators: the fixed one passes 4/4, the one that
  was live fails only on the behavioural check
- Run on the VPS against the real published workspace
  (`/home/jkai/workspace/fd30c69b…/live`) — Chromium launches, 4/4 green
