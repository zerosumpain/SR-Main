# JKAI activity fabric — staged implementation plan

**Date:** 2026-09-04

**Branch:** `plan/jkai-activity-fabric-20260904`

**Base:** `github/master` at `8bfcc810`

**Design:** `docs/superpowers/specs/2026-09-04-jkai-activity-fabric.md`

**Current scope:** implementation in progress after owner approval; do not
deploy or create a production PR until the owner explicitly asks to wrap the
cumulative batch.

## Implementation status — 2026-09-04

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 | Evidence-gated | Public API constraints are encoded; real owner exports/tokens are still required before Apple Music, YouTube Music or Apple Podcasts can graduate. |
| M1 | Working foundation | Contracts, eleven-table schema, grants, durable queue, cursor/outbox writes, erasure and fixture provider are implemented. |
| M2 | Working foundation | Owner-only APIs, provider-aware six-step onboarding, readiness/blocker states, verified-data preview, recommended grants, activity audit, data-access matrix and operations catalogue are implemented. |
| M3 | Gated adapters | Steam is beta-ready behind flags. Apple Music snapshot code exists but remains `planned` until a real account fixture passes M0.1. |
| M4 | Gated pipeline | Encrypted Takeout upload, inspection, confirmation and idempotent import are implemented; provider remains `planned` until a real export passes M0.2. Apple Podcasts remains truthfully planned. |
| M5–M7 | Not started | Consumer tools/projections, extended providers and beta hardening remain subsequent slices. |

## Intended first-release outcome

An owner can open `/jkai/sources`, connect Steam and Apple Music, import a
verified Google Takeout archive for YouTube/YouTube Music, preview normalized
activity, choose which JKAI consumers may use it, inspect provenance in
`/jkai/activity`, ask JKAI bounded questions through provider-neutral tools and
delete a connection with all derived data.

Apple Podcasts is included in the product and contract from the start. Its
first usable path only ships if an actual Apple export fixture proves one; if
not, the catalogue truthfully shows `Device bridge planned` while catalogue
enrichment is prepared. Reddit archive import and GitHub follow in the same
programme; Reddit live OAuth waits for approval.

## Delivery rules

1. Each slice lands behind `ACTIVITY_FABRIC_ENABLED`; each provider also has an
   independent flag.
2. Start owner-only but enforce a principal on every store method. Route auth is
   not the data authorization boundary.
3. No connector may emit an event type that its fixture cannot prove. In
   particular, Apple Music recent items are snapshots, not timestamped plays.
4. Provider payloads are fixtures in tests only after identifiers and secrets
   are redacted. No personal archive is committed.
5. Every stage must leave re-sync idempotent and deletion testable.
6. Do not introduce a new infrastructure service during phase one.
7. Run targeted tests during a stage and `npm run gate` before a PR is prepared.
8. Do not deploy or merge as part of this plan unless the owner separately asks.

## Milestone map

| Milestone | User-visible result | Providers |
| --- | --- | --- |
| M0 — evidence gates | Verified fixtures and accurate catalogue states | Apple Music, YouTube Music, Apple Podcasts, Reddit |
| M1 — fabric core | Durable normalized events, jobs, cursors, grants and deletion | Fixture provider |
| M2 — source experience | `/jkai/sources`, onboarding, preview and activity audit | Fixture provider |
| M3 — first live sources | Real personal gaming and music evidence | Steam, Apple Music |
| M4 — archive sources | Historical import with reports and replay safety | Google Takeout; Apple Podcasts only if proven |
| M5 — consumers | JKAI tools and safe Daydream/Briefing projections | All enabled sources |
| M6 — extended sources | Work/social activity | GitHub, Reddit archive; Reddit OAuth after approval |
| M7 — hardening | Owner beta exit criteria and operational runbook | All enabled sources |

---

## M0 — close the evidence and policy gates

**Depends on:** nothing.

**Output:** private test fixtures, a capability matrix and go/no-go decisions.

### M0.1 Apple Music authorization spike

- Configure a MusicKit identifier/private key in the secret vault without
  adding it to the repository.
- Add a throwaway local-only diagnostic route or script that generates a
  short-lived developer token, lets the owner authorize MusicKit and fetches
  recently played tracks/resources.
- Record only response shape statistics: fields present, ordering, duplicates,
  pagination, token expiry/revocation and HTTP rate behaviour.
- Confirm that individual responses do not include trustworthy play timestamps
  before finalizing `media.track.recently_seen`.
- Destroy diagnostic tokens and remove the spike before M3 production code.

**Gate:** a redacted JSON fixture and written field map exist; the UI limitation
copy matches observed behaviour.

### M0.2 Google Takeout inspection

- The owner exports the smallest YouTube/YouTube Music history bundle possible
  using Google Takeout and places it in an ignored local fixture directory.
- Inspect filenames, encodings, locale/date behaviour, stable ids, deletions and
  whether YouTube Music is explicitly identified.
- Define a generic `media.video.watched` fallback. Define
  `media.track.listened` only if the source itself provides an unambiguous
  discriminator.
- Write a policy note distinguishing user-provided archive data from YouTube
  API data and keep cross-source Daydream correlations disabled pending review.

**Gate:** importing the same redacted sample twice would have a stable natural
key; ambiguous records are not labelled as music.

### M0.3 Apple Podcasts feasibility

- Inspect an owner-requested Apple privacy export without committing it.
- Look specifically for episode identity, occurrence time, progress/completion
  and device/account semantics.
- If suitable records exist, define and redact a minimal fixture for the generic
  archive importer.
- If not, record a no-go for server import and retain a future device-bridge
  manifest. Public podcast catalogue lookup remains enrichment only.

**Gate:** ship either a proven parser target or an explicit `planned` catalogue
state. An empty or speculative importer does not pass.

### M0.4 Reddit access and export

- Request an account archive and inspect the documented record sets locally.
- Submit/confirm the required Reddit developer access application before any
  live API code is enabled.
- Decide raw-content retention separately from activity metadata.

**Gate:** archive schema is fixture-tested; live provider flag remains false
until approval evidence is recorded.

### M0 verification

- No secrets or full archives appear in `git status`, logs or test snapshots.
- A checked-in capability matrix states `live`, `import`, `device`, `planned`
  or `blocked` for every provider operation.
- Product copy has been reviewed against the primary provider documentation.

---

## M1 — build the fabric core with a fixture provider

**Depends on:** M0 field/evidence decisions, not provider credentials.

**Output:** provider-independent persistence and jobs proven without network
calls.

### M1.1 Pure contracts and registry

Create:

- `src/lib/activity/contracts/event.ts`
- `src/lib/activity/contracts/provider.ts`
- `src/lib/activity/contracts/grant.ts`
- `src/lib/activity/contracts/query.ts`
- `src/lib/activity/providers/registry.ts`
- `src/lib/activity/providers/fixture/adapter.ts`

Implement the version-one event envelope and evidence rules from the design.
The fixture adapter must exercise event, snapshot, inferred, archive and
tombstone records without importing the database or network modules.

Tests reject:

- unknown event versions/types;
- `provider_snapshot` records that claim a duration/completion;
- a missing `observedAt`;
- `occurredAt` later than an allowed provider clock-skew window;
- a cross-principal connection/event mismatch; and
- raw text smuggled into metadata-only measures.

### M1.2 Schema and credential ownership

Add the eleven design tables to `src/lib/db/schema.ts` using the repository's
existing naming and timestamp conventions. Add plain indexes for hot lookups:

- connections by principal/provider/status;
- jobs by state/run time and lease expiry;
- source objects by connection/provider object id;
- events by principal/observed time, connection/observed time, category/time
  and provenance object id;
- grants by principal/consumer;
- outbox by delivery state/created time; and
- daily projections by principal/date/signal.

Bind encrypted credentials to connection and principal. If extending the
existing `integration_credentials` table would create an unsafe mixed global
and per-user state, add a narrow credential-binding table instead and migrate
only activity credentials.

Keep external provider ids and cursors out of logs. Use app-enforced
idempotency plus a collision-aware insert transaction; choose database unique
constraints only after confirming the repository's noninteractive Drizzle push
will not prompt.

Tests cover cascading/tombstone behaviour, principal isolation, duplicate page
replay and a credential lookup that cannot cross connection ownership.

### M1.3 Durable job, lease and outbox loop

Create:

- `src/lib/activity/sync/enqueue.ts`
- `src/lib/activity/sync/worker.ts`
- `src/lib/activity/sync/lease.ts`
- `src/lib/activity/sync/errors.ts`
- `src/lib/activity/sync/outbox.ts`
- one heartbeat activity registration for the worker.

Requirements:

- job kinds `initial_sync`, `incremental_sync`, `import`, `erase`, `reproject`;
- `queued → leased → running → succeeded|retry_wait|failed|cancelled`;
- lease recovery after process death;
- provider/connection concurrency caps;
- exponential backoff with jitter plus `Retry-After` precedence;
- page transaction includes source objects, normalized events, cursor and
  outbox rows; and
- poison records are reported individually without silently dropping a whole
  import.

The fixture provider fails deterministically on selected pages so retry,
checkpoint and exact replay can be asserted.

### M1.4 Grants, redaction and erasure

Create one policy function used by every consumer:

```ts
authorizeActivityRead({ principalId, connectionId, consumer, dataClass,
  category }): Allow | Deny;
```

Add redaction projections for metadata, normalized activity and raw content.
Implement immediate read revocation plus an asynchronous erase job that
tombstones outbox consumers and deletes credentials, raw objects, events and
daily projections in a deterministic order.

**M1 acceptance:** two fixture principals ingest identical provider ids without
collision or leakage; a crash/retry produces no duplicate logical events; a
revoked consumer reads zero records immediately; erasure leaves only a
secret-free audit marker.

---

## M2 — source onboarding and activity audit UI

**Depends on:** M1.

**Output:** complete flow against the fixture provider before live providers
add variability.

### M2.1 Internal APIs

Implement the `/api/activity/v1` routes from the design with shared request
validation and stable problem codes. All mutating requests use same-site CSRF
protection, owner auth, principal resolution and `Idempotency-Key` where replay
is possible.

Add persistent OAuth transaction storage now even though the fixture provider
does not redirect. Each transaction is one-use, expiring, principal/connection
bound and stores only a hash/reference to the PKCE verifier.

Contract tests cover unauthorized requests, wrong-principal ids, expired OAuth
state, pagination stability, optimistic grant version conflicts and response
redaction.

### M2.2 `/jkai/sources`

Create small components rather than one provider-specific page:

- `SourceCatalogCard`
- `ConnectedSourceRow`
- `ConnectionModeBadge`
- `EvidenceBadge`
- `SyncFreshness`
- `ImportProgress`

Server-load provider manifests and connection summaries; do not put secrets or
raw payloads into page data. Add Sources and Activity to the JKAI launcher, not
the mobile bottom navigation.

### M2.3 shared connection wizard

Implement the seven design steps as a route state machine under
`/jkai/sources/[provider]/connect`. Refresh/back navigation must preserve a
pending server connection without replaying authorization or upload actions.
The provider manifest supplies limitations and scope copy.

The preview endpoint returns a bounded, redacted sample from quarantined/source
objects. Initial grants are not written until the user confirms the preview.

### M2.4 connection detail, grants and activity timeline

Implement:

- `/jkai/sources/connections/[connectionId]`;
- `/jkai/settings/data-access`;
- `/jkai/activity`; and
- `/jkai/activity/[eventId]`.

Evidence mode, occurrence uncertainty and source freshness must be visible at
both timeline and detail level. Add accessible keyboard/focus behaviour,
responsive states and non-colour status cues.

### M2.5 operations

Extend current connection operations with provider catalogue and durable job
views. Actions are enqueue/retry/cancel/disable; the browser never invokes an
adapter directly. Token values and provider payloads are never rendered.

**M2 acceptance:** an owner can add the fixture source, preview, grant, sync,
inspect, revoke and erase it entirely from the UI. Reloading during sync or
authorization does not corrupt the flow.

---

## M3 — first live providers: Steam and Apple Music

**Depends on:** M2 and the relevant M0 gates.

**Output:** useful current personal activity from official sources.

### M3.1 Steam

Implement `src/lib/activity/providers/steam/`:

- OpenID identity flow with returned identity bound to the pending connection;
- server-side Web API key use;
- owned/recent game and achievement streams;
- opaque cursor/snapshot state; and
- privacy-aware health outcomes (`healthy`, `private`, `rate_limited`,
  `credential_error`, `provider_error`).

Normalization:

- emit `game.library.observed` snapshots;
- emit `game.playtime.changed` with the observed delta and polling interval,
  labelled `inferred_delta` rather than an exact session;
- emit timestamped `game.achievement.unlocked` only when the provider supplies
  an unlock time; and
- never convert a private response to zero activity.

Tests use official-shape fixtures for a public account, private account, zero
games, timestamped and untimestamped achievements, a playtime reset/correction
and a rate-limited response.

### M3.2 Apple Music

Implement `src/lib/activity/providers/apple-music/`:

- server-generated short-lived MusicKit developer token;
- browser MusicKit user authorization;
- encrypted Music User Token binding;
- recent tracks/resources and library sync only for the scopes/features proven
  in M0; and
- disconnect/revocation guidance matching Apple's supported behaviour.

Normalization:

- emit `media.track.recently_seen` and `media.resource.recently_seen` with
  `occurredAt: null`, `observedAt: sync time` and
  `evidenceMode: provider_snapshot`;
- preserve recent-list order as a source measure, not a timestamp;
- diff snapshots without claiming that disappearance means deletion or that a
  repeated item represents another play; and
- do not generate listening minutes or completed plays.

The connection card says `Live snapshot` and the preview states the timestamp
limitation before grants are selected.

### M3.3 provider scheduling and health

Add provider-specific minimum intervals, jitter and rate-budget reporting.
Manual sync requests coalesce with a queued scheduled sync. Stale thresholds
are based on provider capability rather than one global number.

**M3 acceptance:** reconnect, token failure, privacy failure, rate limit,
idempotent resync and full erase pass for both providers. The activity timeline
never renders Apple Music sync time as play time or Steam playtime delta as an
exact session.

---

## M4 — archive pipeline and media imports

**Depends on:** M2, M0.2 and M0.3.

**Output:** historical activity imported safely and repeatably.

### M4.1 archive intake

Implement quarantined, resumable uploads with compressed and expanded-size
limits. Validate magic bytes rather than extension; reject absolute paths,
`..`, links, nested archive abuse and excessive file counts. Calculate the
archive checksum while streaming.

`inspectImport` produces a manifest and sample without creating activity
events. The user chooses date range, recognized datasets and consumer grants
before the import job starts. Retain the archive only until the configured
post-import review window, then erase it automatically.

### M4.2 Google Takeout / YouTube Music

Implement `src/lib/activity/providers/google-takeout/` using the M0 fixture:

- locale-tolerant timestamp parsing with explicit rejected-row reports;
- stable source keys independent of archive filename/order;
- `media.video.watched` as the safe base type;
- `media.track.listened` only when an explicit source marker proved in M0 is
  present; and
- import deletion/replay by `importId` without affecting another import.

Do not call the YouTube Data API to fill history gaps. Optional catalogue
enrichment is a later, separately reviewed feature and cannot change an
activity event's evidence mode.

### M4.3 Apple Podcasts conditional parser

If M0.3 passed, implement the Apple export parser under
`src/lib/activity/providers/apple-podcasts/`. Emit played/completion/progress
fields only when directly present. Enrich episode labels from public catalogue
data asynchronously while preserving the export record as provenance.

If M0.3 failed, implement only the disabled provider manifest and accurate
catalogue state. Record a separate future design for an iOS/device bridge; do
not add placeholder events or fabricate sample data in the user's timeline.

**M4 acceptance:** a duplicate archive is detected before ingest; interrupted
imports resume; bad rows are visible; re-import is idempotent; raw archive
expiry works; deleting one import removes its solely-derived events and
reprojects affected days.

---

## M5 — JKAI, Daydream and Briefing consumers

**Depends on:** M3 and M4; can begin with fixture data after M2.

**Output:** activity becomes useful without bypassing policy.

### M5.1 provider-neutral JKAI toolset

Register one lazy-loaded `activity` toolset in the existing site-tool registry:

- `activity_sources`
- `activity_search`
- `activity_get`
- `activity_summary`

Each tool resolves the principal from trusted execution context, evaluates the
consumer grant, enforces date/row/character budgets and returns coverage and
evidence mix. Tool arguments never accept an arbitrary principal id.

Tests cover revoked sources, partial/private sources, stale data, raw-content
denial, prompt-sized result caps and the difference between empty and
unavailable.

### M5.2 projection worker

Consume `activity_outbox` into rebuildable daily rows. Projection functions are
pure: event set + grant version + definition version → daily output with
contributing event ids and evidence counts.

Initial projections:

- Steam playtime delta and achievements;
- Apple Music recent-list diversity/turnover, explicitly snapshot-quality;
- timestamped YouTube/YouTube Music import counts;
- Apple Podcast plays only if M4.3 shipped; and
- freshness/coverage for every connection.

Changing or deleting an event enqueues the affected principal/date/signal for
rebuild. A definition version bump supports deterministic backfill.

### M5.3 Daydream and Briefing

Register projection-backed signals through Daydream's existing signal
registry. Absence remains unknown, not zero. Signals below their evidence or
coverage threshold are omitted and record a reason.

Briefing receives only bounded changes such as “gaming time increased compared
with your covered baseline” or “Apple Music recent-list diversity changed.” It
does not expose raw Reddit text or claim Apple Music listening duration.

Keep YouTube-derived cross-source correlations feature-disabled until the M0
policy gate is signed off.

**M5 acceptance:** revoking Daydream removes source contributions on the next
read and queues re-projection; JKAI reports evidence limitations; replaying the
outbox and rebuilding projections yields identical results.

---

## M6 — GitHub and Reddit

**Depends on:** M5 core consumer value; Reddit live also depends on approval.

**Output:** work/social sources reuse the proven fabric.

### M6.1 GitHub

Prefer a GitHub App for least-privilege, revocable installation access; use
OAuth only if the app model cannot meet the owner flow. Honor ETags,
`X-Poll-Interval`, documented event latency and the historical window.

Normalize event metadata and action, with repository names private by default
when the source is private. Do not ingest source code or issue bodies as raw
activity content in this milestone.

### M6.2 Reddit archive

Implement from the M0 fixture using the common archive pipeline. Let the user
select record groups before import. Normalize action metadata separately from
post/comment bodies; raw bodies require the Intel/raw-content grant and a short
retention setting.

### M6.3 Reddit live connection, conditional

Only after approval, add the documented OAuth scopes and polling adapter behind
`ACTIVITY_PROVIDER_REDDIT_LIVE_ENABLED`. Record approval/terms version in the
provider manifest. Implement provider deletion compliance and immediately stop
new sync if approval or credentials lapse.

**M6 acceptance:** GitHub and Reddit pass the same contract suite as Steam and
Apple Music; private/raw fields remain absent from default JKAI and Daydream
responses.

---

## M7 — hardening, beta exit and operations

**Depends on:** all providers intended for the owner beta.

**Output:** an observable, recoverable service ready for an explicit PR/deploy
request.

### M7.1 operational controls

- provider kill switch and per-connection pause;
- queue depth, oldest queued job, lease recovery and dead-letter visibility;
- success/stale/rate-limit/auth-failure measures by provider without account
  identifiers;
- outbox/projection lag;
- raw archive/object retention sweeper; and
- audit events for grants, connect, reconnect, disconnect and erase.

Alerts point to an operator action and do not include provider payloads.

### M7.2 failure and abuse testing

- expired/replayed OAuth state and PKCE mismatch;
- callback delivered to another session/principal;
- webhook replay/invalid signature if a webhook provider is added;
- zip traversal, decompression bomb, invalid encoding and oversized archive;
- provider 401, 403/private, 404 deletion, 429 and 5xx storms;
- worker death at each page transaction boundary;
- credential rotation during a sync;
- out-of-order revision/tombstone;
- grant revocation during a model tool call; and
- erasure followed by a stale queued sync.

### M7.3 documentation and release evidence

Add:

- provider setup runbook and required operator credentials;
- user-facing privacy/data-mode explanation;
- per-provider disconnect/delete behaviour;
- data retention table;
- backup/restore implications for erased records;
- incident steps for leaked provider credentials; and
- invited-user readiness checklist.

Run targeted tests throughout, then:

```bash
npm run gate
git diff --check
git status --short
```

Before deployment, review the complete cumulative diff, rendered mobile/desktop
screens, `docker compose config` for any affected local service and local
endpoints documented by the repository. Production deployment remains a
separate explicit owner action through the normal CI path.

### Owner beta exit checklist

- Steam and Apple Music have completed at least seven days of scheduled sync
  without duplicate logical events.
- A Google Takeout import has been previewed, interrupted, resumed, replayed and
  erased.
- Apple Podcasts visibly reflects its proven mode; no false `Connect` promise.
- Every enabled source can reconnect and erase from the UI.
- JKAI distinguishes `empty`, `partial`, `snapshot_only`, `stale` and
  `unavailable`.
- Daydream exposes only provenance-backed projections and never allocates
  untimestamped snapshots to a fabricated day.
- Raw Reddit/social text is absent unless its independent grant is on.
- No access token, raw archive data or private activity appears in logs,
  analytics or error reporting.

## Suggested PR boundaries after planning approval

Keep the programme reviewable without leaving half-secure public surfaces:

1. **PR A — core and fixture:** M1, internal tests only, feature flag off.
2. **PR B — source UI and internal APIs:** M2, fixture provider available only
   in local/test.
3. **PR C — Steam and Apple Music:** M3, owner feature flags off by default.
4. **PR D — archive imports:** M4, Google Takeout and conditional Apple
   Podcasts.
5. **PR E — consumers:** M5, grants and projections enabled incrementally.
6. **PR F — GitHub/Reddit and hardening:** M6–M7, split again if policy approval
   timing differs.

Each PR includes schema, tests, operational visibility and deletion behaviour
for its own surface. No provider ships as a UI-only card disconnected from a
working, truthfully described ingestion mode.
