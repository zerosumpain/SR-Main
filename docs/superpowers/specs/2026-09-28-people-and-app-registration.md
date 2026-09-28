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

## P2 — registration backend (SR-Main + pilot)

- `GET /native/register?provider=google&device=<nonce>` → Auth.js Google sign-in with a `sr_register`
  cookie; the `signIn` callback admits an unknown email **only** with that cookie, as a *registrant*
  (no allow-list row, no grants). The finish page records an `access_request` (`source: 'app'`,
  `wants.app`) and redirects to `srapp://registered?code=<one-time>`.
- `POST /api/native/register/apple {identityToken, name?}` → verify the JWT against Apple's JWKS
  (`aud` = bundle id), record the request keyed by Apple `sub` (new `account_identity` table:
  provider, subject, email, person email once linked), return a one-time code.
- A registrant's code redeems at `/api/native/pair` into a credential that reaches only
  `/api/native/me`, which answers `{status: 'pending' | 'declined' | 'active', access}`.
- Approving links the identity to a person (for a relay Apple address the dialog asks for their Google
  email, optional), and when the role includes the family circle, `/api/native/companion-pair` hands the
  phone a companion code through its site credential — no QR.
- Declining revokes the credential.

## P3 — the app (SR-AppleApp)

- Fresh install with neither pairing → **Welcome**: Continue with Google, Sign in with Apple, "I have a
  pairing code". Phones already paired never see it.
- Registrant → **Your account is being reviewed** (name, email, sign out), rechecked on foreground and
  background refresh; declined → says so. Active → tabs, companion pairing fetched automatically.
- OnboardingTests re-pinned; TestFlight; server before app.
