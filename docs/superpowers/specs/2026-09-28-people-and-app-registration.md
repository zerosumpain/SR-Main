# People: one place to manage users, and registering from the app

2026-09-28. John: "user onboarding and management isn't very intuitive" — (1) a person should register
entirely from the iPhone app and see only "your account is being reviewed" until approved; (2) account
management is spread across pages, and the per-user permissions UI duplicates options (Family Circle vs
Family Admin).

## Where things were

- One human = up to 8 records joined by email (`allowed_user`, `access_request`, `access_invite`,
  `activity_principals`, `household_member`, pilot `users`, pilot credentials, `native_credentials`),
  managed across `/admin/access` (6 stacked sections), `/admin/access/devices`, `/admin/access/security`
  (a stale allow-list copy), `/home/people/settings` (no add), and `/welcome` (self-service sharing).
- The editor: a Groups checklist, then a 12×4 radio grid of one-off grants, then Family circle / Family
  admin checkboxes — family appears three times. It never shows what a person holds through a group, and
  ~15 radios are "Same as self". `family:admin` alone half-works (the app says family, the web routes and
  `/welcome` pairing check `family:circle` exactly).
- Remove deleted the allow-list row only: both phone credentials and the household email link survived.
- The app has no sign-in; every person is added on the web first, then pairs by QR from a second screen.

## Decisions (John, 2026-09-28)

| # | Question | Answer |
|---|---|---|
| D1 | App sign-in | **Google AND Sign in with Apple** (App Store 4.8). Apple may hand over a relay address, so an Apple identity is linked to a person, not assumed to be their Google email. |
| D2 | Permission model | **One role per person + adds.** A person holds at most one role (an `access_group`); one-off grants only add on top. |
| D3 | Order | **Site first** (P1), then the registration backend (P2), then the app (P3). |
| D4 | Approving a family registrant | **Link or create their household row in the approve dialog.** |

## Decision log (self-approved, reversible)

- **Catalogue and `effective.ts` are NOT changed in P1.** Both are byte-shared with SR-Drive, SR-Jkai-Core
  and SR-Health. The family fix is write-side instead: every save normalises `family:admin` ⇒ also
  `family:circle` (`$lib/access/roles.ts`), and the two prod rows already hold both.
- **Roles are `access_group` rows; `allowed_user.groups` holds ≤ 1 id.** No schema change. The API takes
  `role` (id or null); a stored list longer than one is read as its strongest member and rewritten on the
  next save. Built-ins keep their ids (`family-circle`, `family-admin`) and are relabelled **Family** and
  **Parent** only where the owner has not already renamed them; a third built-in **Friend** (news, chat,
  games — never locations) is seeded.
- **Adds only add.** A one-off grant the role already satisfies is dropped on save, so the stored list
  is exactly the difference.
- **`jkai.knowledge` is not a control.** It is held automatically with any intel level (its blurb already
  said "give intel too"); nothing on Main gates on it.
- **A person's page is keyed by household subject when they have a household row, else by email** —
  so the Life360-only children, who have no account, are people on the same list.
- **`/home/people/settings` redirects to `/admin/access`**; its form logic moves to the person page.
- **Remove cascades**: allow-list row, both lanes' phone credentials, the household row's email link
  (source `companion` → `none`, since a companion row with no email maps nobody). Their material and the
  pilot's stored data stay; deleting data stays an explicit, separate action.

## P1 — the People environment (SR-Main only)

`/admin/access` (nav: People):
1. **Waiting** — pending requests (web now, app in P2). Approve = pick a role; if the role includes the
   family circle, pick a household person to link (unlinked rows only) or "new household person".
2. **People** — one row per human: owner, allow-listed people, household-only people. Row = name, email,
   role, a plain summary of adds, phone count, location source. Click → person page.
3. **Add someone** — by Google email with a role, or as a one-time invite link with a role.
4. **Invites** and **Roles** — collapsed; the role editor uses the same access editor.

`/admin/access/[person]`:
- **Access** — role cards, then Family (None / Circle / Parent), then one row per area showing only the
  choices that differ; the role's level is shown as the floor ("from Parent") and cannot be lowered here.
- **Household** — name, sign-in email, location source (+ Home Assistant person for Life360), WhatsApp,
  alerts, and "parent of" (shown when Parent). Link / unlink / create.
- **Phones** — both pairings for this email, revoke each.
- **View as** and **Remove** (cascade above).

Verification: unit tests for `roles.ts` (choices, family normalisation, add pruning, summary) and the
people join; the gate; then on prod: `/admin/access` lists 2 accounts + 3 household-only children, Katie
reads **Parent** with her adds, and `/home/people/settings` 3xx's to `/admin/access`.

## P2 — registration backend (SR-Main) — as built

- **Google:** the app's private sign-in sheet opens `/welcome/app`, which sets `sr_register` (10 min) and
  hands straight on to Google. The Auth.js `signIn` callback admits an unknown email only while that cookie
  is present. `/welcome/app/finish` records the request (`ensureAppRequest`: once; a no in the last 30 days
  shows the no), mints a one-time pairing code, DELETES the web session, and redirects to
  `srapp://registered?code=…`.
- **Apple:** `POST /api/native/register/apple {identityToken, name?}` — RS256 against Apple's JWKS (node
  crypto, kid refetch on rotation), `iss`, `aud` = bundle id (`APPLE_BUNDLE_ID` → `APNS_BUNDLE_ID` → default),
  `exp`, verified email. Rate-limited per address. **Never mints the owner's code** (403): the owner's phone is
  paired from an owner web session only. The relay address (`…@privaterelay.appleid.com`) IS the person's
  email — no identity table; linking a Google address for the web is a later person-page action.
- Both redeem at `/api/native/pair`, whose `mayHoldDevice` now also admits a **registrant** (latest request
  pending or declined, no grants). A registrant's device reaches only `/api/native/me`, which answers
  `{role:'registrant', status, name, email}` (approved-with-nothing answers as a member with no flags).
- `DELETE /api/native/register` — a registrant withdraws: requests deleted, credentials revoked.
- `POST /api/native/companion-pair` (`withNativeAccess('any')`, owner or `family:circle`) upserts the pilot
  user and returns `{server, code}` so an approved phone connects health & location with no QR.
- The Waiting list tags app requests "from the app · Apple/Google" (`wants.via`).

## P3 — the app (SR-AppleApp)

- Fresh install with neither pairing → **Welcome**: Continue with Google, Sign in with Apple, "I have a
  pairing code". Phones already paired never see it.
- Registrant → **Your account is being reviewed** (name, email, sign out), rechecked on foreground and
  background refresh; declined → says so. Active → tabs, companion pairing fetched automatically.
- OnboardingTests re-pinned; TestFlight; server before app.
