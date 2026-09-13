# Accepted Policy Analysis extraction

John confirmed signed-in browser acceptance on 13 September 2026. Policy Analysis
is owned by `zerosumpain/SR-Policy-Analysis`; route and worker ownership are recorded
in `module-ownership.json`. New Policy features belong in that repository.
Policy Engine and Policy Incentives Lab are separate products.

This cleanup removes Main's Policy pages/API, implementation, dashboard components,
fixtures, offline fonts and build. Main retains navigation to the external app,
shared schema definitions, historical SQL and the general workflow queue. No data
migration or deletion is required. Future Policy SQL belongs to the independent
repository; shared queue/settings changes remain Main-owned.

Main cannot claim Policy jobs, even with missing or legacy worker flags or an
explicit Policy trigger filter. Its lease sweep also leaves Policy rows alone.
The dedicated Policy worker owns execution and recovery. Main's release smoke
checks Policy through its gateway on 5290, with the canonical host and existing
owner cookie; it no longer expects the implementation on Main's 4173 listener.

## Release and rollback

The scoped cleanup is based on deployed Main revision
`6e4fcd60486484538016ff53b321b8deef370372`. Keep that immutable Main release and
Policy image `sr-policy-analysis:ae3832c07cbe`, configuration backups, database and
sealed keys until the release retention policy allows their removal.

After this cleanup reaches production, a routing-only rollback to the NEW Main
release cannot serve Policy. Prefer rollback to the previous Policy web image,
leaving its dedicated worker and data in place. If returning the UI/API to Main,
first restore the retained pre-cleanup Main release through immutable release CI
with external Policy worker ownership still enabled, verify it, and only then
restore cloudflared routing. Never use the legacy rsync deploy script.

Worker ownership rollback is a separate operation: stop/drain the dedicated Policy
worker and investigate its active lease before enabling the retained Main worker.
Never enable two owners. Do not reset data or sealed-key storage.

## Validation

Focused worker, queue, Word renderer and release-shape tests cover the changed
contracts. The opt-in PostgreSQL test uses a session-local temporary queue table
on loopback `jkai_local`, exercising real claim and sweep SQL without modifying
application tables:

```sh
POLICY_QUEUE_TEST_DATABASE_URL=postgresql://jkai_local:jkai_local_only@127.0.0.1:15435/jkai_local \
  npm test -- tests/lib/workflows/external-policy-queue.integration.test.ts
```

The cumulative local checkout carries the same cleanup alongside earlier work.
Its LAN gateway continues to serve Policy from the independent app. Production
CI rollout automation and its candidate web slot are the next migration milestone.

Validation completed on 13 September 2026: 45 focused unit tests and three
PostgreSQL ownership tests passed; type checking passed with zero errors and 857
existing warnings (using an empty local `PUBLIC_VAPID_PUBLIC_KEY`). The production
build, public-route inventory, module boundaries, source footprint and client
budgets passed. Main's authenticated local Policy page/API return 404; the LAN
gateway serves Policy landing, personas, history API and an existing report with
200 responses. Main homepage and News also return 200. Policy web and worker
container start times stayed unchanged through the local Main restart.
