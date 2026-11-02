# sr. tv Phase 1 — foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A linked Android TV opens a party, shows a QR, players join from a browser by name (or the app as themselves), and the TV runs a full game of Boggle with its own board.

**Architecture:** A new in-memory *party* layer (`party.server.ts`) sits above the existing room registry: the TV owns a party (people + game choice), and `start` makes an ordinary room with `createGame` and joins everybody, so rules modules are unchanged. TVs are linked once by the owner (HMAC token + `games-tvs` datastore row). The TV front end is SvelteKit at `/games/tv` inside a thin Kotlin WebView shell (SR-TV repo).

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, vitest, Playwright, `qrcode`, `$lib/datastore`; Kotlin + Android Gradle Plugin, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-02-sr-tv-app-design.md`

## Global Constraints

- Public routes: everything a TV or guest reaches lives under the existing public prefix `/games` (`/games/tv`, `/games/tv/install`, `/games/join/<CODE>`), plus new PUBLIC_PATHS `/tv` (redirects only), `/api/games/tv`, `/api/games/party`. Each handler authenticates itself. Run `npm run gate:public-routes -- --write` after creating them.
- Codes: `CODE_ALPHABET` / `CODE_LENGTH` from `$lib/games/screens` (4 consonants).
- Tokens: HMAC-SHA256 over `AUTH_SECRET` with context strings `games-tv.` and `games-seat.`; compare with `secretsMatch`.
- Guest player ids: `v_` + 12 hex. Family ids stay `playerId(email)` (`p_…`).
- Party max members 8; join rate limit 10 per IP per 10 min.
- No family first names in source — read `listMembers()` at runtime.
- Design system: DM Mono `sr.` mark (`--font-brand`), Archivo Black display, DM Sans body, JetBrains Mono labels (`--font-mono`), tokens only, radius 0/2px/100px, no emoji, 12px font floor (`gate:font-sizes`).
- Svelte: handles in plain `let`, never `$state` (svelte5-pitfalls §1); no effect that reads its own write.
- Avoid bare Tailwind utility words and the global `.card` as class names — prefix TV classes `tv-`.

## Review Focus

1. A guest refreshes `/games/join/<CODE>` mid-game → same seat back (cookie), not a second "Sam 2". Test in Task 3.
2. The TV reloads mid-game (or a deploy restarts nothing but the page) → TV gets its party + running board back. Test in Task 3 (openParty is idempotent per TV).
3. A kicked guest's next act/stream is refused 403 and they cannot rejoin a locked party. Test in Task 3.
4. A forged/revoked `sr_tv` cookie cannot open a party (401) — the public stream must not mint parties for anyone. Test in Task 2/5.
5. Starting with too few/many players for the game → a sentence on the TV, no room created. Test in Task 3.

---

### Task 1: Pure tokens and party helpers — `src/lib/games/party.ts`

**Files:** Create `src/lib/games/party.ts`, `src/lib/games/party.test.ts`

**Produces:**
- `issueTvToken(tvId: string, secret: string, now?): { token: string; expiresAt: number }` — `tv_<12hex>.<exp10>.<nonce24hex>.<hmac64>`, 400 days.
- `verifyTvToken(token, secret, now?): string | null` → tvId.
- `issueSeat(partyId: string, memberId: string, secret, now?): string` — `<partyId>.<memberId>.<exp>.<hmac>`, 12 h.
- `verifySeat(seat, partyId, secret, now?): string | null` → memberId (must match partyId).
- `newTvId()`, `newGuestId()` (`v_`+12 hex), `newPartyId()` (`pt_`+12 hex).
- `cleanGuestName(raw: unknown, taken: string[]): string | null` — trim, collapse spaces, 1–16 chars, letters/digits/space/'-; `isClean(name, 'kids')` from `quiz-night.ts`; de-dupe "Sam" → "Sam 2".
- `PARTY_GAMES: readonly GameId[]` (Phase 1: `['boggle']`), `partyRange(game): { min: number; max: number }` (min from `minPlayers ?? 1` capped to game, max `min(8, maxPlayers ?? MAX_PLAYERS)`).

- [ ] Tests: round-trip, tamper (each segment), expiry, wrong party for seat, name cleaning (empty, too long, blocked word, dedupe twice → "Sam 3").
- [ ] Implement; `npx vitest run src/lib/games/party.test.ts` passes; commit.

### Task 2: Linked TVs — `src/lib/games/tv-devices.server.ts`

**Files:** Create `tv-devices.server.ts` + test.

**Produces:**
- Store interface `{ list(): Promise<TvRow[]>; get(id); put(row); }` backed by datastore collection `games-tvs` (`ensureCollection` with an owner actor, records keyed by tv id); `_setTvStore()` for tests.
- `openLinkWait(): { code; expiresAt; events }` / link waiting registry (cap 50, 20 min), `approveLink(code, name): Promise<TvRow>` emits `linked` with a fresh token.
- `tvFromCookie(cookie: string | undefined): Promise<TvRow | null>` — token valid AND row present AND not revoked; 60 s cache; updates `lastSeenAt` at most every 10 min.
- `revokeTv(id)`, `listTvs()`, `renameTv(id, name)`.
- `linkStream(): Response` — SSE `{type:'code'}` then `{type:'linked', token}`.

- [ ] Tests (memory store): approve unknown code 404; approved token verifies; revoked fails; forged fails.
- [ ] Implement, pass, commit.

### Task 3: Parties — `src/lib/games/party.server.ts`

**Files:** Create `party.server.ts` + `party.server.test.ts`.

**Consumes:** Task 1, `createGame`, `act`, `watch`, `subscribe`, `roomStage`, `ensureRoom` from `rooms.server`, `GAMES`.

**Produces:**
- `type PartyView = { id; code; phase: 'lobby'|'playing'; locked; game: GameId|null; options; members: {id,name,kind,active}[]; roomId: string|null; games: {id,title,min,max}[]; joinUrl: string }`.
- `openParty(tvId): PartyView` (idempotent per TV; reopens after close).
- `partyByCode(code)`, `tvAct(tvId, action, body)`: `pick {game, options}`, `start`, `kick {memberId}`, `lock`, `unlock`, `end`, `close`.
- `joinFamily(code, player: {id,name}): {party, memberId}`; `joinGuest(code, name, ip): {party, memberId, seat}`; `rejoin(code, memberId)` (cookie path).
- `memberAct(code, memberId, action, body)` → room `act`; refuses kicked/inactive (403).
- `tvStream(tvId): Response` — party frames + `{type:'room', room: toScreen}` while playing (via `watch`), `{type:'party'}` on every change.
- `memberStream(code, memberId): Response` — party frames + `{type:'room', room: toWire}` (via `subscribe`).
- `start`: checks range (sentence: "Boggle needs 1–8 players — 1 joined."), `createGame({game, host: first active, invite: rest, difficulty: options.difficulty ?? 'medium', options})`, `act(join)` per invitee, `act(host,'start')`. Room gone → party back to lobby (`onGone`).
- `_resetParties()`.

- [ ] Tests: open idempotent; guest join → member; rejoin same id; dedupe; locked refuses; kick → act 403; start Boggle with 2 → room playing, both in it; start with 0 → refusal; end → lobby; close → code dead; 9th join refused; rate limit.
- [ ] Implement, pass, commit.

### Task 4: Guests never reach the leaderboard

**Files:** Modify `src/lib/games/rooms.server.ts` (`record`), test in `rooms.server.test.ts`.
- [ ] Failing test: a finished Boggle room with a `v_` player records only the `p_` rows.
- [ ] Filter rows whose `playerId` starts with `v_`; pass; commit.

### Task 5: Routes and the owner page

**Files:**
- `src/lib/auth.ts` PUBLIC_PATHS: `/tv`, `/api/games/tv`, `/api/games/party` (commented like `/games`).
- `src/routes/api/games/tv/link/+server.ts` (GET link SSE), `claim/+server.ts` (POST {token} → verify → set `sr_tv` cookie), `party/+server.ts` (GET open/return party; POST tv verbs), `party/stream/+server.ts`.
- `src/routes/api/games/party/[code]/+server.ts` (GET party summary for the join page; 404 sentence for unknown), `join/+server.ts` (POST {name}; or session → family), `act/+server.ts`, `stream/+server.ts`.
- `src/routes/api/native/games/party/[code]/join/+server.ts` (`withNativeAccess('games')`).
- `src/routes/admin/games/tvs/+page.server.ts` + `+page.svelte` (owner: type code + name → link; list, rename, revoke). Precedent: an existing small `/admin/*` form page.
- `src/routes/tv/+server.ts` → 302 `/games/tv`; `tv/get/+server.ts` → 302 latest SR-TV release asset; `tv/version.json/+server.ts` (Task 9).
- [ ] Route tests for: claim with forged token 401; party POST without cookie 401; join unknown code 404; native join.
- [ ] `npm run gate:public-routes -- --write`; commit.

### Task 6: Boggle on the TV

**Files:** Modify `src/lib/games/boggle.ts` (`toScreen`, party `maxPlayers` 8, "Kelly word of the round": from the solved words ∩ `KELLY_WORDS` in `$lib/games/kelly.ts`, else the longest common word; finding it doubles its points; revealed at the finish), `boggle.test.ts`; create `src/lib/games/kelly.ts` (themed words: train, rail, tea, kettle, biscuit, bridge, river, quaker, engine, track, steam, scone…, host lines, places), `src/lib/components/games/boggle/BoggleTable.svelte`; register in `src/routes/games/[game]/+page.svelte`.
- `toScreen`: grid, phase, endsAt, per player `{id,name,count,score}`, finish: all words by player, crossed, missed, Kelly word.
- [ ] Tests: `toScreen` never leaks words while playing; Kelly word doubles; screen at finish lists words.
- [ ] Board: 16:9 cqw stage, grid left, scores right, countdown ring; finish reveals; commit.

### Task 7: `/games/tv` — the TV front end

**Files:** `src/routes/games/tv/+page.server.ts` (reads `sr_tv` → linked? + TV name; noindex), `+page.svelte`; `src/lib/components/tv/{focus.ts, TvShell.svelte, TvLink.svelte, TvMenu.svelte, TvLobby.svelte, TvBoard.svelte, TvAbout.svelte, tv-stream.ts}`.
- `focus.ts`: `roving(node)` action — arrow keys move to the nearest focusable in that direction (by bounding rect), Enter = click; `data-tv-focus` marks focusables; first focus on mount.
- Link screen: code + "Open strangeramblings.com/admin/games/tvs on your phone" → on `linked`, POST claim, reload.
- Menu: tiles for `PARTY_GAMES` (title, range, blurb) + About + Leaderboard; sting "made by John for the Kellys".
- Lobby: QR (server SVG from `$lib/server/qr.ts` via page data or `/api/games/tv/party` returning `qrSvg`), big code, URL, members with kick, lock toggle, options (Boggle size/seconds/difficulty), Start.
- Board: switch by game to the existing table components (Boggle now; Azul/Quiz/Codenames later), Back → sheet End game / Back to lobby.
- [ ] Playwright smoke in Task 11; commit.

### Task 8: `/games/join/[code]` — join and the Boggle web controller

**Files:** `src/routes/games/join/[code]/+page.server.ts` (party summary; signed-in family member? → name prefilled, joins as self), `+page.svelte`; `src/lib/components/games/play/{PlayShell.svelte, play-stream.ts, Lobby.svelte, Finished.svelte}`, `src/lib/components/games/play/boggle/BogglePad.svelte`.
- iOS user agent: try `sr://games/join/<CODE>` once, fallback after 1.2 s to the form.
- Boggle pad: grid with drag-to-trace (pointer events, adjacency check client-side with `neighbours`), typed fallback, own found list, toast for refused words (server sentence).
- [ ] Commit.

### Task 9: Install path

**Files:** `src/routes/games/tv/install/+page.svelte` (steps with Downloader, `strangeramblings.com/tv/get`, adb fallback), `src/routes/tv/get/+server.ts`, `src/routes/tv/version.json/+server.ts` (GitHub API `repos/zerosumpain/SR-TV/releases/latest`, cached 10 min; 503 sentence if none), `scripts/install-tv.sh`.
- [ ] Commit.

### Task 10: Android shell — new repo `zerosumpain/SR-TV` (independent; parallel subagent)

**Files (new repo `~/sr-tv`):** `settings.gradle.kts`, `build.gradle.kts`, `app/build.gradle.kts` (minSdk 24, target 35, versionCode from `GITHUB_RUN_NUMBER`), `app/src/main/AndroidManifest.xml` (LEANBACK_LAUNCHER + LAUNCHER, `android.software.leanback` required=false, touchscreen required=false, INTERNET, REQUEST_INSTALL_PACKAGES, banner), `MainActivity.kt` (WebView, keep-screen-on, immersive, cookies persisted, Back → JS `window.srTvBack?.()` returning true if handled else finish), `Updater.kt` (version.json → dialog → DownloadManager → FileProvider install intent), `res/drawable/banner.xml|png` 320×180, icon, error page asset, `.github/workflows/release.yml` (JDK 17, `./gradlew assembleRelease` signed from secrets `KEYSTORE_B64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`; `gh release create v<run>` with `sr-tv.apk`), `README.md`.
- [ ] CI green; release asset exists; `aapt dump badging` shows `leanback-launchable-activity`.

### Task 11: End to end, gate, ship

- [ ] Local prod build on the Tailscale IP; Playwright: link a TV (approve via test helper), open party, two browser guests join, start Boggle, trace a word, finish, back to lobby; screenshots at 1920×1080 + phone 390×844.
- [ ] `./scripts/gate-remote.sh --build` green.
- [ ] PR → CI green → squash merge → master deploy → verify live: `/games/tv` 200 contains "Link this TV"; `/tv/get` 302; `/games/join/ZZZZ` "no party"; `POST /api/games/tv/party` without cookie 401.
- [ ] Link John's TV is John's step (via `/admin/games/tvs`).
