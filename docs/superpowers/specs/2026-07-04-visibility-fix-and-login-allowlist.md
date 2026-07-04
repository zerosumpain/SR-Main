# Spec — Project-visibility toggle fix, site review, and login allow-list admin

**Date:** 2026-07-04
**Mode:** Autonomous (Full grade — self-approved gates, Decision Log below)
**Kick-off:** "review the projects, some won't toggle public/private — fix autonomously; do a
site-wide review and fix deployment issues; add a component in /admin to add new Google users to
the login allow-list."

## Task 1 — Some projects won't toggle public/private

**Root cause (confirmed, not theorised).** `/projects/+page.svelte` renders `visToggle(key,…)`
cards for `scs-earnings` (Field Study №6, added in commit b3c77846) and `broads-pilot`
(Field Study №5), but `STATIC_PROJECT_KEYS` in `src/lib/projects/registry.ts` omits both. The
toggle POSTs to `/api/projects/visibility`, which validates `key` against
`getAllowedProjectKeys()` (= `STATIC_PROJECT_KEYS` ∪ published build slugs) and returns
`400 Unknown project key`. The page reverts optimistically → the toggle silently does nothing.

The *guards* already work for both: `scs-earnings` is a static bundle served by
`projects/[slug]/[...path]/+server.ts` (which gates any slug via `project_visibility`);
`broads-pilot` gates via its `+layout.server.ts` → `requireProjectPublic`. So the fix is purely
the registry omission.

**Fix.** Add `'scs-earnings'` and `'broads-pilot'` to `STATIC_PROJECT_KEYS`. Add a regression
test asserting every toggle key rendered on `/projects` is in the allow-list, so a new card can
never silently ship un-toggleable again (this is the recurring "deployment issue" class).

## Task 2 — Site-wide review + fix deployment issues

Run `npm run check` + `npm run build` (surface real breakage). Run an adversarial multi-dimension
code review over the diff + auth security + the visibility system + a drift scan. Fix only
concrete, safe, in-scope issues; log anything larger as a deferred follow-up.

## Task 3 — Admin component: add Google users to the login allow-list

**Key finding.** `AUTH_ALLOWED_EMAILS` is used in two roles: (a) the sign-in gate
(`hooks.server.ts` `signIn`), and (b) the **owner** allow-list (`/api/auth/me`, `/api/jkai/forge/*`,
push). Simply appending guests to that list would make every guest a full site owner — wrong.

**Design (least privilege).**
- New table `allowed_user` (`email` PK, `note`, `added_by`, `created_at`) = the guest login
  allow-list.
- `AUTH_ALLOWED_EMAILS` stays the **owner** list.
- New `src/lib/server/access.ts` = single source of truth: `getOwnerEmails()`, `isOwnerEmail()`,
  `isEmailAllowedToSignIn()` (owner ∪ DB guest, owner checked first so a DB outage never locks the
  owner out), plus pure helpers `parseEmailList`/`emailAllowed` for unit tests.
- `signIn` → `isEmailAllowedToSignIn`. Guests can now sign in.
- **Owner-gate `/admin/*`** in the hook (after the LAN bypass, so homeserv local admin is
  unaffected): a guest can use the authed site but not the admin console — which edits the very
  allow-list. Owner-gate `/api/admin/access` the same way.
- Admin UI `/admin/access` (+ `/api/admin/access` GET/POST/DELETE, owner-gated in the hook):
  list owners (read-only), list/add/remove guests. Mirrors `/admin/keys` (PageWrap/PageHeader,
  `nm-*` classes).
- Nav entry in `AdminShell.svelte`.

## Files to touch
- `src/lib/projects/registry.ts` — +2 keys.
- `tests/lib/projects/registry-cards.test.ts` (new) — card/registry parity guard.
- `src/lib/db/schema.ts` — `allowed_user` table.
- `src/lib/server/access.ts` (new) — owner/allow-list logic.
- `src/lib/server/access.test.ts` (new) — pure-helper unit tests.
- `src/hooks.server.ts` — signIn → access helper; owner-gate `/admin/*` + `/api/admin/access`.
- `src/routes/api/admin/access/+server.ts` (new) — GET/POST/DELETE.
- `src/routes/admin/access/+page.server.ts` (new) — load owners + guests.
- `src/routes/admin/access/+page.svelte` (new) — UI.
- `src/lib/components/admin/AdminShell.svelte` — nav item.

## Verification
- `npm run check` clean; `npm test` for the two new test files green; `npm run build` clean.
- Live: authed toggle of `broads-pilot`/`scs-earnings` returns 200 (was 400). `/admin/access`
  loads for owner; add a throwaway guest → row appears → remove it. Deploy stamps matching SHA.

## Decision Log
1. **Toggle fix = registry addition, not a refactor.** Options: (a) add the 2 keys; (b) derive
   allowed keys from a shared card manifest. Chose (a) + a parity *test* — smallest reversible fix
   that also prevents recurrence. Centralising the card list is a larger refactor; deferred.
2. **Guests ≠ owners.** Options: (a) union guests into `AUTH_ALLOWED_EMAILS` (guests become
   owners); (b) separate DB guest list, env stays owners. Chose (b) — least privilege, matches the
   literal ask ("allow list for logging in"). Reversible (drop table).
3. **Owner-gate `/admin/*`.** Making the allow-list editable while `/admin` is open to any authed
   user would let a guest edit the allow-list. Gating `/admin` to owners closes that. Placed after
   the LAN bypass so homeserv local admin is unaffected. Reversible (remove the check).
4. **Broader authed surfaces (`/jkai`, `/live`, …) NOT role-gated.** Full per-surface RBAC is a
   large project beyond this brief. Guests can currently reach authed non-admin pages. Flagged as a
   follow-up in the final report rather than built now (irreversibly large; John can scope it).
5. **Owner list stays env-based.** Not migrating owners to the DB — avoids a bootstrap/lock-out
   risk and keeps existing owner checks byte-for-byte identical. `access.ts` consolidates the
   duplicated env-parsing so future drift (the Task-1 class of bug) is less likely.
