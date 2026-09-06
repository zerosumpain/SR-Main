# Daydream investigation lifecycle

The engine should begin with quantitative observations, ask the default JKAI
model to challenge possible explanations, accumulate evidence over time, and
request capabilities that make valuable questions answerable.

## Implemented in the cumulative local batch

- Daydream inference and review inherit the default for new JKAI conversations;
  explicit daydream/reviewer pins remain authoritative. Model reporting matches.
- Each new model-proposed statistical question must contain a bounded plan:
  benefit, competing explanations, supporting and contradicting observations,
  and specific evidence needs with acceptance checks.
- Proposer coverage and prior questions are scoped to the person. Owner feature
  aggregates in the ponder pack no longer pool household measurements.
- Calendar-date lag alignment does not pair across gaps. Historical associations
  remain exploratory until at least 20 paired days after proposal are available.
- A non-significant or practically small estimate is inconclusive, not disproved.
  Supported still means association; competing explanations are not ruled out.
- Summable repeated-look spending replaces the divergent 1/k allowance. This
  does not establish causality or remove assumptions of the correlation method.
- Assessments atomically retain their evidence snapshots and verdict history.
  Overlapping workers cannot append duplicate results from the same starting
  state, and unchanged evidence does not become another statistical look.
- Discoveries exposes the investigation and history; snapshot reads survive
  corrections to the underlying source. Legacy records are labelled explicitly.
- Capability planning receives unresolved development/connection evidence needs.
  Self-improvement intake re-reads their original acceptance criteria and carries
  the investigation reference through the existing capability/backlog link.
  Requests to observe, ask, or look up evidence are not automatically build work.

## Operational notes

The release pipeline applies scripts/migrations/2026-09-06-daydream-investigations.sql
in a bounded transaction before switching the live app, and stamps its checksum
only after success. It is additive and idempotent, preserves
legacy conclusions, and changes old statistical refuted labels to inconclusive.
No historical source snapshots are fabricated. New schemas can also be created
through the existing Drizzle workflow; the SQL data migration is still required
for legacy terminology/history.

Local endpoint: http://127.0.0.1:5275/jkai/daydreams/discoveries. Local setup and
synthetic replay instructions live in /home/john/docker/local/README.md.

## Subsequent capabilities from the review

1. Explicit conversational needs with open/bought/cancelled/snoozed lifecycle,
   conservative completion inference and source links.
2. Event-driven opportunity scheduling, advance source verification, delivery
   expiry, and a fresh location/offer/need check immediately before notification.
3. Receipt line items, recurring charge reconciliation, unit prices and net
   savings calculations with quantities, refunds and conditions accounted for.
4. A general investigation identity linking musings and non-correlation studies;
   revisions of the current hypothesis plan and source acquisition outcomes.
5. Evidence-arrival triggers and measured capability outcomes: a shipped tool or
   PR should not count as a resolved question until usable observations arrive.
6. Outcome evaluation for useful suggestions, realised savings, missed windows,
   false alerts, and reasoning cost. Do not optimise for thoughts generated.

The current batch establishes the statistical investigation loop. It does not
claim that shop-entry reminders, automatic need extraction or realised-savings
measurement are implemented. Production deployment is authorised separately; this batch sends no external
notifications.

## SR design audit — 2026-09-06

Reviewed the Discoveries investigation view against the Strange Ramblings design
skill and the current JKAI shell/tokens. Reading copy uses 16px Selawik; plan
rows and assessment history use semantic structure and hairline separators.
Recorded numeric values use the existing JetBrains Mono table class. Metric
headers reuse the signal catalogue labels and units; unknown signal units are
explicitly unavailable. Loading, failed reads, retry, missing readings, legacy
provenance and synthetic examples remain distinct. Disclosure and table scrolling
are keyboard accessible, with expanded/busy state and visible focus.

Browser checks passed at 1440px, 390px and 320px, including long content,
loading/error/retry/empty-evidence responses, font resolution and overflow.
Existing font-size, measure, public-route and module-boundary gates passed,
along with 60 targeted unit tests. The full repository type check reported four
unrelated root-relative imports in tests/e2e/mapbox.spec.ts; no daydream errors
were reported. This audit covers the investigation view, not a sitewide redesign.
