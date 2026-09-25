# Intel spaces PR B — members, member Gmail, household drive folders

**Spec:** `docs/superpowers/specs/2026-09-24-intel-spaces-and-domains-design.md` §5, §6 (PR B).
**Predecessors:** A1 #939, A2 #940 (live 2026-09-25). Written against merged code, as the
A1/A2 plan required.

**Goal:** a family member promoted at `/admin/access` signs in, reaches the `/jkai/intel`
read surfaces for their own space plus household, connects their own Gmail read-only,
and triages their own held mail into their graph. Nothing of the owner's reaches them,
and no owner machinery can reach their mailbox.

## Decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | How does member mail reach their graph? | **Member triage.** Members admit/reject their own held threads on `/jkai/intel/mail`. The sweep stays gated (zero model spend unattended); each admit is one capped, member-initiated extraction. Rules, backfill, purge stay owner-only. (John, AskUserQuestion) |
| 2 | Recall (`/jkai/intel/search`) | **Left off the member allow-list.** It POSTs to the unscoped `/api/jkai/knowledge/search`, which also reads Drive, deep dives, memory and the datastore. The graph's `q` filter and the entities index cover member keyword search. (John) |
| 3 | Household drive folders | **API in Main + a Mine/Household select in SR-Drive's `FolderIntelModal`**, server first. (John) |
| 4 | `activity_principals` check constraint | **Not widened.** `space_id` carries no FK, so `'household'` needs no principal row; changing a CHECK through `drizzle-kit push` is a risk for no gain. Members are `kind:'user'`, which the constraint already allows. |
| 5 | Scope for a sessionless request | **Owner.** The hook only lets a sessionless request reach an intel route through an owner-grade lane (maintenance secret, JKAI service token, dev LAN). A session that is neither owner nor member gets 403 from `resolveRequestScope` itself — defence in depth, not trusting the hook. |
| 6 | Member Gmail identity | **The Gmail address must equal the member's sign-in email**, and an existing `gmail_accounts` row is never reassigned to another principal. Signed `state` (HMAC over AUTH_SECRET) on every connect. |
| 7 | Demote / revoke | Role back to `guest` (or row deleted): their data stays, their Gmail accounts go `status='revoked'` so the nightly sweep stops reading a mailbox whose owner lost access. |
| 8 | Whole-night model ceiling | **Not added.** Member sweeps are gated (no model calls); member admits are request-capped (40, 60s) like the owner's. Logged for the day a member lane spends unattended. |
| 9 | Lens / dossier slug prefixes | **Not in PR B** — members cannot create either. Insight dedupe keys ARE prefixed: the nightly engine writes member insights, and a member insight over household entities collides with the owner's key today. |
| 10 | Member chrome | `/jkai` layout returns no hub metrics for a member (spend, credit, Codex, workflow counts are owner data); the shell hides ActivityStrip, launcher, tab bar, spend pill and the `← chat` chip. |

## Member allow-list (exact, method-aware — `isMemberAllowedPath(pathname, method)`)

Pages (GET): `/jkai/intel`, `/jkai/intel/notes`, `/jkai/intel/notes/[id]`,
`/jkai/intel/entities`, `/jkai/intel/entities/[id]`, `/jkai/intel/timeline`,
`/jkai/intel/mail`.

APIs GET: `/api/jkai/intel/network`, `/api/jkai/intel/network/paths`,
`/api/jkai/intel/evidence-network`, `/api/jkai/intel/entity-card`,
`/api/jkai/intel/entities`, `/api/jkai/intel/entities/[id]`, `/api/jkai/intel/notes`,
`/api/jkai/intel/notes/[id]`, `/api/jkai/intel/mail`, `/api/gmail/connect`,
`/api/gmail/callback`.
APIs POST: `/api/jkai/intel/mail` only (actions admit, reject, requeue, similar,
score-relevance; backfill-embeddings already owner-only).

Dropped from the spec's list: `source-facets` (a cross-space maintenance backfill, not a
facet reader), `mentions` (review-page only), search (decision 2), timeline API (none
exists — the page loads server-side).

## Tasks

### T1 Schema, member store, admin toggle
- `schema.ts`: `allowed_user.role text NOT NULL DEFAULT 'guest'`;
  `drive_folder_settings.space_id text` (nullable = inherit). Plain columns, no index.
- `src/lib/server/members.ts` (new): `memberPrincipalFor(email)` (allowed_user.role =
  'member' AND activity_principals kind 'user' external_ref = email → id or null);
  `setMemberRole(email, role)` — promote creates the principal idempotently
  (`u_` + 10 random base36), demote revokes their Gmail accounts; `revokeMemberGmail`.
- `/api/admin/access`: `PATCH { email, role }`; list carries `role`; DELETE revokes Gmail.
- `/admin/access` page: role toggle per guest; copy updated.
- Verify: `members.test.ts` (pure bits), `drizzle-kit push` diff read on :5433.

### T2 Gate and scope seam
- `$lib/auth.ts`: `isMemberAllowedPath(pathname, method)` over exact patterns (a `[id]`
  segment matches one non-empty segment, never `/`).
- `hooks.server.ts` API + page branches: owner → guest-allowed → member (`role` +
  allowed path) → 403 / redirect.
- `scope.server.ts` `resolveRequestScope`: session email → owner / member principal
  (`[u_x, 'household']`) / throw 403; no session → owner (decision 5). Cached on
  `locals` per request.
- `$lib/server/viewer.ts` (new): `viewerOf(event)` → `{ kind: 'owner'|'member'|'none',
  principalId }` shared by the hook, the scope seam and layouts.
- Tests: `auth.test.ts` cases for the member list (prefix siblings refused, POST refused
  except mail); `scope.server` unit test with mocked session + members module.

### T3 Chrome
- `jkai/+layout.server.ts`: member → `{ member: true, deploy, hub: EMPTY_HUB }`, no reads.
- `jkai/+layout.svelte`: member → no ActivityStrip, JkaiLauncher, JkaiTabBar; HubHeader
  `member` prop hides meters, spend link, ⌘K chip and the back chip.
- `jkai/intel/+layout.server.ts`: `member` flag + the member's own Gmail accounts
  (email, status) for the connect panel.
- `jkai/intel/+layout.svelte`: member menu = member surfaces only, no Add / Hub groups.
- `workbench.ts`: `memberVisible` flag on SURFACES (graph, notes, entities, timeline, mail).

### T4 Intel pages in member mode
- `/jkai/intel/+page.svelte`: skip mount fetches to clusters / duplicates / watchlist;
  hide findings, commission bar, Gmail sweep, sweep history, and tiles to owner surfaces;
  add a "Your mail" rail section (connect / reconnect, status).
- `EntityCard.svelte`: hide watch, dossier pin, trust fetch/edit, commission actions.
- entities index bulk actions, note retry/delete, "new note" link: hidden for members.
- `/jkai/intel/mail/+page.svelte`: hide rules, seed and index panels for members.

### T5 Gmail — owner machinery never touches a member mailbox
- `$lib/workflows/gmail/owner-accounts.ts` (new): `ownerGmailAccountsWhere()`,
  `assertOwnerGmailAccount(acct)`.
- Apply at: gmail-ingest `resolveAccount` default + id path for owner callers,
  gmail-ingest route, watcher, orchestrator-bridge auth-expired push, site-tools gmail
  (resolve, list), workspace-grounding, `/api/gmail/accounts` (+ DELETE), gmail workflow
  nodes' `loadAccount`, `accounts/[id]/{test,labels,watches}`, admin gmail page + admin
  connections `gmailTest`, connector probe + summary banner, source-facets
  `backfillImportant` (and its note update scoped to owner).
- Rolling sweep: every active account (drop the owner clause); each lands in its
  principal's space (already true).
- `connect`: member → `gmail.readonly openid email`, `include_granted_scopes:false`;
  owner unchanged. Signed state both ways.
- `callback`: verify state; principal from the SESSION; member Gmail address must match;
  never reassign an existing row; insert stamps `principalId`; redirect member to
  `/jkai/intel?gmail=…`.
- `mail-admit.ts`: account = the note's `gmailAccount`, must belong to the note's space
  (fail closed); attachments skipped outside the owner space.
- `mail-decisions.ts`: `spaceId` on each decision; `ownerDecisions` only owner-space
  (missing = owner, historical rows); mail API actor `'member'` for members.
- `engine.ts` readers include every active Gmail principal, so an entity-less member's
  queue is scored at night.

### T6 Insight dedupe keys per space
- `insight-store.ts`: stored key = bare for owner, `${space}:${key}` otherwise, at
  persist and at every lookup by key.

### T7 Household drive folders
- `source-policy.ts`: `FolderSetting.spaceId`, `ResolvedPolicy.spaceId` (nearest ancestor
  with a space; default owner; only `owner|household`).
- `source-policy.server.ts`: context carries it; `policyForFileName` returns `spaceId`;
  `syncSourcePolicy` moves an included file whose derived note sits in another space
  (cleanup old note, re-extract via reindex).
- `file-index/store.ts`, `drive-outbox.ts`: extract into the resolved space.
- `deleteDerivedIntel('file', …)`: finds the note in any Drive space (owner + household).
- `/api/drive/folders` PUT accepts `space: 'owner'|'household'|null`.
- SR-Drive: `FolderIntelModal` select, after Main is live.

### T8 Isolation proof
- `members.integration.test.ts` (skipIf no DATABASE_URL; creates and deletes only its
  own rows): a real `allowed_user` member + principal, REAL `resolveRequestScope` over a
  faked session; owner rows seeded; network, evidence-network, entity-card, entities,
  notes, note detail, timeline + intel page loads, mail queue return none of them.
- Hook-level: `hooks-member-gate.test.ts` over the extracted gate decision for commission,
  ingest, `/jkai`, `/jkai/intel/search`, knowledge search, owner-only POSTs.
- `route-scope.test.ts`: every member-allowed route file must call
  `resolveRequestScope`.

HARD RULE for every implementer: never run a delete / bulk update / cleanup / purge /
merge / engine path against the dev DB (127.0.0.1:5433) except inside a test touching only
rows it created. Prove RED with assertions or throwing spies, never a live run.

## Verification

- `./scripts/gate-remote.sh` green; integration test green locally against :5433.
- Live: owner `/jkai/intel` unchanged (200, graph counts unchanged); `/admin/access` shows
  the role toggle; unauthenticated member paths 401; `drizzle` columns present on prod.
- Member session end to end: a forged dev session against a local server (dev
  AUTH_SECRET), since no family account exists yet to sign in with.
