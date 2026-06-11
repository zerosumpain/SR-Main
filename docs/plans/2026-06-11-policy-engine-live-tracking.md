# Policy-engine live-data tracking — implementation plan (2026-06-11)

Connect The Whitehall Model's outcome indicators to live official data, track reality
vs the model's projections, and refresh automatically as new data is released via jkai
cron workflows. Every indicator carries a **"data last updated"** stamp.

## Architecture (decided)

The deterministic engine is left untouched. A **parallel observation layer** records what
actually happened per indicator per official release, and the UI renders the delta.

- **Brains in testable TypeScript, not in workflow nodes.** All extraction / dual-comparator
  projection / status logic lives in `policy-engine/lib/tracking/*` + a server route, unit-tested.
- **jkai workflows are thin cron triggers** that POST to an internal ingest route. The workflow
  is the automation/scheduling layer (visible in the canvas); it carries no fragile logic.
- **Release-gated:** the ingest route re-fetches + rewrites a dataset only when its EES
  publication `lastPublished` advances past the stored `releaseDate` (content-hash for non-EES).
- **Dual comparator (per John):** drift is computed vs BOTH the status-quo (`baselineLevers()`)
  and the announced-policy (`policyLevers()`) projections, stored side by side.

## Verified live sources (June 2026, EES v1 API, no auth)

EES `POST /statistics/v1/data-sets/{guid}/query` (pin every filter to Total / a breakdown option):
KS4 (A8, grade5 EM; Total/Disadvantaged/EHCP), KS4 gap index, KS2 RWM (Total/Disadvantaged),
EYFSP GLD (Total/FSM), SEN-in-England (% SEN support, % EHCP, headcounts), pupil absence
(persistent, severe, overall), NEET-16-17 LFS brief (quarterly). GUIDs/ids in `registry.ts`.
Non-EES: ONS NEET 16-24 (xlsx via exceljs), World Bank (clean JSON), ONS mid-year pop (CSV).
Key-gated / deferred (documented, not auto-fetched v1): DWP Stat-Xplore child poverty, EPI
"months" gaps, IFS funding, MoJ tribunals, SEN2 timeliness, school-workforce FTE.

## Build phases

0. **schema + pure logic (TDD):** `policy_indicator_snapshots` table; `tracking/{types,registry,
   projection,status,freshness}.ts`.
1. **server ingestion (TDD w/ fixtures):** `tracking/{ees,sources,ingest}.server.ts`.
2. **automation:** `api/policy-engine/ingest` route (Bearer `POLICY_INGEST_SECRET`); seed script for
   the 4 cron workflows (ees-weekly / neet-quarterly / context-monthly / annual-census).
3. **read path + UI:** `monitor/+page.server.ts`; TrackingTable + FreshnessDot; OutcomeChart observed
   overlay; ConfidenceBadge freshness + MeasurementPopover observed row.
4. **verify + deploy + seed.**
