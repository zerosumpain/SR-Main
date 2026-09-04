# JKAI activity fabric — product and technical design

**Date:** 2026-09-04

**Status:** Proposed; implementation has not started

**Companion plan:** `docs/superpowers/plans/2026-09-04-jkai-activity-fabric.md`

## Owner brief

Give an individual a clear way to connect the services that reflect what they
do — initially Steam, Reddit and other common services — then make that
activity safely available to JKAI and subservices such as Daydream. Use Apple
Music, YouTube Music and Apple Podcasts for the initial media-source track.

## Product promise

**Sources connect accounts. The activity fabric records evidence. JKAI,
Daydream and workflows consume only the projections the user grants them.**

This distinction is load-bearing. A provider response is not automatically a
fact about what a person did, and a recently-played list is not an exact play
history. The UI and data contract must preserve that difference instead of
manufacturing precision.

## Decisions proposed for the first release

1. Build an `activity` domain between integrations and consumers. Daydream is
   a consumer, not the canonical store.
2. Keep it inside the current SvelteKit/PostgreSQL application initially. Use
   the existing heartbeat/leader mechanism and durable jobs; do not introduce
   Kafka, Redis or a second deployable until measured load requires one.
3. Support both Apple Music and YouTube Music. Apple Music is a live but
   snapshot-quality connection; YouTube Music begins as a Google Takeout
   import because the official API cannot read watch/listening history.
4. Treat Apple Podcasts as a first-class catalogue entry, but label it
   `Import/device bridge` until a real Apple export fixture proves a reliable
   import. Apple's publisher APIs do not expose a listener's play history.
5. Ship owner-only first, while putting a `principalId` on every connection,
   event, cursor, grant and job so invited-user support does not require a data
   model rewrite.
6. Default to metadata and aggregates. Raw post bodies, comments, search text
   and precise location require separate, explicit grants.
7. All connectors are read-only in this programme. Posting, liking, editing,
   playlist mutation and other write actions are out of scope.

## Provider reality and launch modes

The catalogue must show how data arrives, not merely whether a provider logo
exists.

| Source | First launch mode | Evidence available | Important limitation |
| --- | --- | --- | --- |
| Steam | Sign in + scheduled sync | Owned/recent games, achievements, playtime snapshots | Sessions and play dates are normally inferred from deltas; private profiles can hide data |
| Apple Music | MusicKit authorization + scheduled sync | Recently played tracks/resources and library metadata | Server responses do not provide a trustworthy timestamp or duration for each play; record a recent-list snapshot, not a completed listen |
| YouTube Music | Google Takeout archive import | Timestamped history where the export identifies it | The YouTube Data API cannot retrieve watch history; do not advertise live listening sync |
| Apple Podcasts | Import/device bridge beta | Only fields verified in an owner-provided export or emitted by a future device bridge | Public catalogue and publisher APIs are not listener-history APIs |
| GitHub | GitHub App or OAuth + polling | Public/private account events within the granted scope | Events are delayed and the public events feed has a limited time window |
| Reddit | Account archive import first; OAuth behind approval | Votes, posts, comments and other archive records selected by the user | API access requires Reddit approval; content is sensitive and is excluded from model context by default |

Existing Gmail, Calendar, Strava, Whoop, Apple Health, location and Home
Assistant integrations are not rewritten before this launches. They register
projections into the fabric progressively after the new contract is proven.

### Why both music services, but in different modes

- Apple Music provides official user authorization and recent-resource
  endpoints. A connector can truthfully say “this item appeared in the user's
  recent list at sync time.” It cannot truthfully say “the user completed this
  track at 21:13 for 183 seconds.”
- YouTube's current API explicitly prevents clients from retrieving watch
  history. A user-requested Takeout archive is the honest first path for
  historical YouTube Music data.
- Apple Podcasts has public catalogue data and publisher tooling, but no
  documented listener-history API. We can enrich a known episode from the
  catalogue; that must not be presented as evidence the user played it.

The relevant primary documentation is [Apple Music API](https://developer.apple.com/documentation/AppleMusicAPI),
[MusicKit](https://developer.apple.com/musickit/),
[Apple Music user authentication](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit?changes=_3),
[recently played tracks](https://developer.apple.com/documentation/applemusicapi/get-v1-me-recent-played-tracks),
[YouTube API revision history](https://developers.google.com/youtube/v3/revision_history),
[Google Takeout](https://support.google.com/accounts/answer/3024190?hl=en), and
[Apple Podcasts distribution guidance](https://podcasters.apple.com/support/5108-how-apple-podcasts-distributes-your-shows-to-listeners).
Apple also states that its podcast publisher API key does not grant listening
analytics in the [hosting-provider API guidance](https://podcasters.apple.com/support/3956-publish-subscriptions-with-hosting-provider).

The other provider decisions rely on the official [Steam OpenID](https://partner.steamgames.com/doc/features/auth?l=english)
and [IPlayerService](https://partner.steamgames.com/doc/webapi/IPlayerService?l=english)
documentation, GitHub's [events API](https://docs.github.com/en/rest/activity/events),
and Reddit's [data API access policy](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
and [account export guidance](https://support.reddithelp.com/hc/en-us/articles/360043048352-How-do-I-request-a-copy-of-my-Reddit-data-and-information).

## Information architecture and UI wireframe

### User routes

| Route | Purpose |
| --- | --- |
| `/jkai/sources` | Source catalogue, connected accounts, last-sync health and a plain-language privacy summary |
| `/jkai/sources/[provider]/connect` | Provider-specific authorization/import wizard |
| `/jkai/sources/connections/[connectionId]` | Connection health, evidence quality, scopes, consumer grants, sync history, reconnect and delete |
| `/jkai/activity` | Filterable activity timeline with source, date and evidence-quality filters |
| `/jkai/activity/[eventId]` | Event provenance: what the provider supplied, what JKAI inferred, revisions and consumers allowed to use it |
| `/jkai/settings/data-access` | Cross-source matrix of source categories against JKAI, Daydream, Briefing, workflows and Intel |

`Sources` and `Activity` should appear in the JKAI launcher. They should not
consume a permanent mobile bottom-tab slot in the first release.

### `/jkai/sources`

The page has four compact sections:

1. **Connected** — provider, account label, mode (`Live`, `Import`, `Device`),
   last successful sync, freshness and any action required.
2. **Add a source** — cards grouped as Games, Music & podcasts, Social, Work,
   Health and Home. Each card states its real mode before the user taps it.
3. **Recent imports** — durable job progress and rejected-record counts.
4. **How JKAI uses this** — a link to the grants matrix and the next deletion
   deadline, if any.

Provider cards use these states: `Available`, `Beta`, `Approval required`,
`Device bridge planned` and `Connected`. Apple Podcasts must not show a
`Connect` action until an implementable mode exists; `Join beta` or `Import
archive` is accurate.

### Connection wizard

All providers use the same seven-step shell; a provider adapter supplies the
copy and relevant controls.

1. **Choose account or archive.** Explain whether this is live sync, import or
   device capture.
2. **See exactly what is available.** List included and unavailable fields.
   Apple Music explicitly says “recent list, no exact play time.”
3. **Authorize or upload.** Use provider authorization in a new window, or a
   resumable archive upload.
4. **Preview.** Show a small sample after normalization, including the evidence
   badge. No consumer can read it yet.
5. **Choose uses.** Separate toggles for JKAI answers, Daydream aggregates,
   Briefing, workflows and Intel content analysis. Defaults are described
   below.
6. **Initial sync.** Show a durable job with progress; leaving the page does not
   cancel it.
7. **Review.** Show the first/last dates, record count, excluded records and a
   prominent disconnect/delete control.

Reconnect is an abbreviated version of the same flow and must not silently
broaden scopes or consumer grants.

### `/jkai/activity`

This is an audit surface, not a social feed. Each row shows:

- activity icon and neutral description;
- occurred time when known, otherwise “seen during sync at …”;
- source/account;
- evidence badge (`Provider event`, `Snapshot`, `Inferred`, `Archive`, or
  `Device`);
- correction/revision state; and
- a details disclosure for measures and provenance.

The empty state points back to Sources. A warning appears when filters include
inferred activity. Users can hide an event, correct its category, or delete it
without deleting the entire connection.

### Operations routes

The current `/admin/connections` remains the operational health dashboard and
`/admin/connections/credentials` remains the secret vault. Add:

| Route | Purpose |
| --- | --- |
| `/admin/connections/catalog` | Provider manifests, enabled modes, required credentials, policy gates and rollout flags |
| `/admin/connections/jobs` | Sync/import job queue, leases, retries, rate-limit state and dead-letter inspection |

Admin routes never expose decrypted tokens or full sensitive payloads.

## System shape

```text
OAuth / API / archive / device
              |
       provider adapters
              |
     source objects + cursors
              |
      canonical activity ledger
          /       |        \
   JKAI tools  Daydream   workflows
                daily      (opt-in)
              projections
```

The adapter translates provider-specific responses. The ledger preserves
evidence and provenance. Consumers never query provider tables directly.

### Modules

| Module | Responsibility |
| --- | --- |
| `src/lib/activity/contracts` | Versioned event, provider manifest, grant and query types; no database imports |
| `src/lib/activity/providers` | Provider registry and adapters; one directory per provider |
| `src/lib/activity/store` | Idempotent objects/events, revisions, tombstones and query access |
| `src/lib/activity/sync` | Durable jobs, leases, rate limits, cursors, retry classification and outbox |
| `src/lib/activity/imports` | Quarantine, format detection, parsers and import reports |
| `src/lib/activity/projections` | Consumer-safe daily aggregates and redacted views |
| `src/lib/activity/policy` | Principal ownership, category classification, grant evaluation and retention |

If polling later competes materially with web traffic, only `sync` moves into a
separate `activity-worker`; the contracts and PostgreSQL queue remain the same.

## Canonical activity contract

An event is immutable evidence with revisions, not an editable row pretending
to be eternal truth.

```ts
type EvidenceMode =
  | 'provider_event'
  | 'provider_snapshot'
  | 'inferred_delta'
  | 'archive_import'
  | 'device_observation';

interface ActivityEventV1 {
  id: string;
  schemaVersion: 1;
  principalId: string;
  connectionId: string;
  source: string;             // steam, apple_music, youtube_takeout, ...
  type: string;               // game.playtime.changed, media.track.recently_seen
  category: string;           // gaming, music, podcast, social, work, ...
  subjectKey: string;
  occurredAt: string | null;  // null when the source does not know
  observedAt: string;         // when JKAI received or observed it
  evidenceMode: EvidenceMode;
  actor: { providerId?: string; label?: string };
  object: { providerId?: string; kind: string; label?: string; url?: string };
  measures: Record<string, number | string | boolean | null>;
  provenance: {
    providerObjectId?: string;
    providerRevision?: string;
    importId?: string;
    derivedFromEventIds?: string[];
    adapterVersion: string;
  };
}
```

Rules:

- `observedAt` is mandatory and is never substituted for an unknown
  `occurredAt`.
- Missing is not zero. A private Steam profile and “zero minutes played” are
  different states.
- Provider object ids plus connection and revision form the idempotency key.
- Updates create revisions; provider deletion creates a tombstone. Historical
  audit data is not silently overwritten.
- Provider snapshots may describe recency/order but do not generate duration,
  completion or exact-time facts.
- Raw text and uploaded archives are stored separately from the normalized
  event. A grant to activity metadata is not a grant to raw text.
- Public URLs are metadata, not permission to fetch and send their content to a
  model.

The envelope borrows the stable ideas of [CloudEvents](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
and the vocabulary shape of [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-vocabulary/),
without claiming wire compatibility with either in version one.

### Initial event vocabulary

| Source | Event types |
| --- | --- |
| Steam | `game.playtime.changed`, `game.achievement.unlocked`, `game.library.observed` |
| Apple Music | `media.track.recently_seen`, `media.resource.recently_seen`, `media.library.changed` |
| YouTube Takeout | `media.video.watched`; `media.track.listened` only when the archive explicitly identifies YouTube Music |
| Apple Podcasts | `podcast.episode.played` only with a source timestamp; otherwise `podcast.episode.recently_seen` |
| GitHub | `code.event.observed`, refined by provider action in `measures.action` |
| Reddit | `social.post.created`, `social.comment.created`, `social.vote.recorded`, `social.saved.changed` |

Do not mint `media.listen.completed`, `media.minutes` or a precise
`game.session` unless the source supplies enough evidence.

## Persistence model

| Table | Purpose |
| --- | --- |
| `activity_principals` | Stable boundary between current owner auth and future invited users |
| `activity_connections` | Provider account, mode, scopes, status, principal, sync policy and encrypted credential reference |
| `activity_oauth_transactions` | Expiring, one-use, principal-bound state and encrypted PKCE verifier |
| `activity_sync_jobs` | Durable sync/import jobs with lease, attempts, checkpoint, progress and typed failure |
| `activity_sync_cursors` | Opaque cursor per connection/stream; adapters own its meaning |
| `activity_source_objects` | Encrypted or redacted provider payload, checksum, provider revision and retention deadline |
| `activity_events` | Canonical immutable event envelope, revision/tombstone links and searchable metadata |
| `activity_imports` | Uploaded archive status, format/version, checksum and parse report |
| `activity_outbox` | Transactional projection notifications and consumer delivery state |
| `activity_consumer_grants` | Principal + connection/category + consumer + data class + allow/deny |
| `activity_daily_projections` | Rebuildable, provenance-linked daily aggregates consumed by Daydream and summaries |

Credentials remain encrypted using the existing integration credential
facility, but an activity credential must be bound to both `principalId` and
`connectionId`. The current global credential model must not be used as the
authorization boundary for user activity.

## Provider adapter contract

Every provider declares capability rather than forcing all services through an
OAuth-shaped abstraction.

```ts
interface ActivityProviderAdapter {
  manifest(): ProviderManifest;
  beginAuthorization?(input: BeginAuth): Promise<AuthRedirect>;
  finishAuthorization?(input: FinishAuth): Promise<CredentialMaterial>;
  testConnection?(ctx: ConnectionContext): Promise<HealthResult>;
  sync?(ctx: SyncContext): AsyncIterable<ProviderPage>;
  inspectImport?(file: QuarantinedFile): Promise<ImportInspection>;
  import?(ctx: ImportContext): AsyncIterable<ProviderPage>;
  disconnect?(ctx: ConnectionContext): Promise<void>;
}
```

`ProviderManifest` declares:

- supported modes (`oauth`, `openid`, `api_key`, `import`, `device`);
- scopes and their user-facing meaning;
- data classes (`metadata`, `activity`, `raw_content`, `location`);
- evidence modes and event types it can emit;
- cursor, webhook and backfill support;
- required secrets and operator policy gates; and
- retention/deletion behaviour.

### Common transport patterns

- OAuth authorization code uses persistent, one-use state with expiry and
  PKCE. The existing in-memory pending-state path is not sufficient for user
  connections or multiple app instances. See [OAuth state](https://www.rfc-editor.org/info/rfc6749/)
  and [PKCE](https://www.rfc-editor.org/info/rfc7636/).
- Steam uses OpenID for identity and the documented Web API for allowed
  snapshots. Provider keys remain server-side.
- Polling cursors are opaque JSON owned by the adapter. Sync honors
  `Retry-After`, provider rate headers and a per-connection backoff.
- Webhooks verify signatures and timestamp windows before they enqueue work;
  webhook handlers never normalize large payloads synchronously.
- Imports are checksummed, malware-scanned/quarantined where available,
  inspected before parsing and resumable by checkpoint. Duplicate uploads are
  harmless.
- Event, cursor and outbox writes occur in one transaction. Consumers read the
  outbox or projections, not half-completed sync pages.
- Mutating API calls accept `Idempotency-Key`. Errors use an
  [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)-style problem body
  with stable machine codes.

## Application APIs

All endpoints are owner-gated in phase one and still evaluate `principalId` at
the store boundary.

| Method and path | Purpose |
| --- | --- |
| `GET /api/activity/v1/providers` | Available provider manifests after feature/policy gates |
| `GET, POST /api/activity/v1/connections` | List or create a pending connection/import |
| `GET, DELETE /api/activity/v1/connections/[id]` | Inspect or revoke; delete accepts an explicit data disposition |
| `POST /api/activity/v1/connections/[id]/authorize` | Begin provider authorization and return a redirect |
| `POST /api/activity/v1/connections/[id]/sync` | Enqueue, never perform, a sync |
| `GET /api/activity/v1/connections/[id]/jobs` | Sync/import progress and failures |
| `PUT /api/activity/v1/connections/[id]/grants` | Replace grants after optimistic-version check |
| `POST /api/activity/v1/imports` | Create a resumable archive upload/import |
| `GET /api/activity/v1/events` | Cursor-paginated timeline with source/category/time/evidence filters |
| `GET /api/activity/v1/events/[id]` | Provenance and revision chain |
| `GET /api/activity/v1/summary` | Policy-filtered daily/weekly aggregate; no raw payloads |
| `POST /api/activity/v1/webhooks/[provider]` | Provider-specific verified ingress |

List pagination is cursor-based and stable on `(observedAt, id)`. Server-side
limits cap date span, row count and response size. The normalized event API is
internal owner functionality in phase one; it is not a public developer API.

## Consumer policy and projections

### Default grants

| Consumer | Default | Data exposed |
| --- | --- | --- |
| JKAI answers | On after preview | Metadata and normalized events; event detail only when a user request needs it |
| Daydream | On after preview | Daily aggregates and coverage/freshness only; never raw social text by default |
| Morning Briefing | On after preview | Small changes and summaries, subject to existing delivery controls |
| Workflows | Off | Only named categories selected by the user |
| Intel/content analysis | Off | Raw text requires a separate explicit grant |
| MCP/external tools | Off | Owner-only toolset and the same grant evaluator if enabled |

The grant key is `(principal, connection, consumer, dataClass)` with optional
category refinement. A global revoke takes effect at read time before any
asynchronous cleanup completes.

### JKAI tools

Expose provider-neutral tools through one `activity` toolset:

- `activity_sources` — connection/freshness/capability status;
- `activity_search` — bounded event metadata search;
- `activity_get` — one event and its provenance, after policy evaluation; and
- `activity_summary` — daily/weekly aggregates with coverage and evidence
  quality.

The model does not receive provider access tokens, raw provider payloads or a
tool per provider. Tool output always includes coverage (`complete`, `partial`,
`snapshot_only`, `stale`) so “I found no activity” is not confused with “there
was no activity.”

### Daydream

Daydream registers projection-backed signals through its existing open signal
registry. Candidate names include:

- `activity.gaming.playtime_minutes` — only provider-event or defensible
  interval-delta evidence;
- `activity.gaming.achievements_unlocked`;
- `activity.music.distinct_recent_items` — Apple Music snapshot-safe;
- `activity.music.listen_events` — archive/device events with a real timestamp;
- `activity.podcasts.episodes_played` — only after a verified source exists;
- `activity.code.events`;
- `activity.social.actions` — counts, not comment bodies.

Every daily row carries contributing event ids, evidence mix and coverage. A
snapshot without an occurrence time can shape “recent interests” but cannot be
allocated to a day's minutes or used in precise cross-signal correlations.

YouTube's developer policies place restrictions on combining API data with
other data. Takeout is a user-provided archive rather than an API response, but
cross-source YouTube-derived Daydream correlations remain disabled until a
documented policy/legal review clears the exact use.

## Privacy, security and lifecycle

- Per-connection credentials are envelope-encrypted at rest and redacted from
  logs, job payloads and errors.
- OAuth callback state is persistent, short-lived, one-use and bound to the
  initiating principal, connection, redirect path and PKCE verifier.
- Archive extraction rejects traversal, links, decompression bombs and
  unsupported nested archives; uploads have compressed and expanded-size caps.
- Raw social content and archives have short default retention. Canonical
  metadata can have a longer user-selected retention window.
- Disconnect offers: stop future sync; delete credentials; delete raw payloads;
  delete all derived events/projections. The default is all four.
- Deletes create a durable erasure job, revoke reads immediately and publish
  tombstones to consumers. The connection page shows completion.
- No provider data is used to train models. Sending data to an inference
  provider follows the user's consumer grant and the existing model policy.
- Audit records contain who changed a grant or connection and when, but never
  secret material.

## Rollout and success criteria

The first usable cohort is the owner account behind feature flags. A provider
graduates from beta only when it has fixture tests, a live health check, an
idempotent re-sync proof, a revoke/delete proof and user-facing evidence copy.

Measure:

- authorization/import completion rate;
- time to first preview and first completed sync;
- sync success, rate-limit and stale-connection rates per provider;
- duplicate and revision rates;
- events excluded by policy or low evidence;
- JKAI tool queries answered with complete versus partial coverage;
- Daydream signals with adequate versus inadequate provenance; and
- disconnect-to-erasure completion time.

No target is based on event volume alone. More low-quality inferred records are
not success.

## Explicit non-goals

- scraping Apple Music, YouTube Music, Apple Podcasts or Reddit UI;
- unofficial cookie/session-token connectors;
- an iOS device bridge in the first server release;
- provider write actions;
- realtime guarantees;
- a public activity API or third-party connector marketplace;
- full invited-user UI in phase one; or
- migrating every existing integration before the new source flow is useful.

## Launch gates and unresolved evidence

These are discovery gates, not reasons to blur the product copy:

1. Obtain Apple Music developer credentials and verify MusicKit authorization,
   refresh/revocation behaviour, recent-list ordering and duplicates against a
   real owner account.
2. Inspect an owner-provided Google Takeout fixture. Confirm how YouTube Music
   is distinguished from general YouTube before emitting music-specific event
   types.
3. Inspect an Apple privacy export for Podcasts data. If it contains no useful
   play evidence, keep Apple Podcasts at `Device bridge planned`; do not ship an
   empty importer.
4. Complete a written YouTube policy review before cross-source projections.
5. Apply for and receive Reddit API access before enabling OAuth sync. Archive
   import can proceed independently after format and deletion tests.

## Decision record

| Decision | Rationale |
| --- | --- |
| Activity fabric, not Daydream tables | Multiple consumers need one provenance and policy boundary; Daydream's daily numeric/boolean signals cannot represent event history |
| PostgreSQL jobs/outbox first | Fits current deployment and expected personal scale while keeping a clean future worker seam |
| Both Apple Music and YouTube Music | They cover distinct user behaviour and have complementary lawful ingestion modes |
| Apple Podcasts shown honestly as import/device | There is no documented live listener-history API to support a normal OAuth card |
| Nullable occurrence time | Prevents sync time from masquerading as activity time |
| Consumer grants after preview | Users should see what the connection actually yields before authorizing downstream use |
| Provider-neutral JKAI tools | Stable prompts, smaller tool surface and centralized policy enforcement |
