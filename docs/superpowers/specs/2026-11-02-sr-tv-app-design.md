# sr. tv — an Android TV app for family games

Date: 2026-11-02. Status: design approved by John in chat ("Yup looks about right make it happen");
autonomous build (design-gated grade) — decisions after the design round are in the Decision Log (§12).

## 1. What John asked for

An Android TV app for strangeramblings that shows a little about the site but is mainly for **full-screen
games**: a menu of games, **scan a QR to join**, **lobby management on the TV**, players join from the
**Apple app** or, where it is missing, the **web**. Easy to install on the test TV (a Sony Bravia, Android TV).
Games: **Boggle**, **Kelly's Quiz Night** (John feeds in material and old photos; a question pack is drafted
from it), the existing TV trio (Azul, Quiz Night, Codenames) and **three new Kelly originals — one reaction
game, one physics game, one board-game style**. Every game should feel personal: first names and places,
"made by John", nothing more personal than that.

Answers in the design round: web guests join **by name** (no account); personal touch = **first names +
places**; quiz material through an **admin upload page**; games = existing trio + three originals.

## 2. Where we start (read before designing)

- 25+ family room games, each a pure rules module behind `GameRules` (`src/lib/games/catalogue.ts`), live
  in `rooms.server.ts` (in memory; durable games in `game_rooms`). Controls exist **only in the iPhone app**
  (`/api/native/games/**`, `withNativeAccess('games')`); the shared bodies are `api.server.ts`.
- A generic **TV board** exists: `/games/<game>` for any game with `toScreen` (Azul, Quiz Night, Codenames).
  Today the phone creates the room and the TV is paired afterwards by typing a 4-letter code
  (`screens.ts` / `screens.server.ts`, HMAC ticket 12 h). Board shell: `components/games/screen/TableScreen`.
- Players are family only: `playerId(email)` = keyed hash; the roster is `games:self` + a live site pairing.
- `game_results` records finished standings for the leaderboard (`results.server.ts`).
- Tap Duel already proves fair reaction timing (server sends `goAt` ahead, the phone measures).
  Marble Race proves deterministic-physics play. The board-games plan (2026-10-22) names **Iron Roads**.
- The Apple app opens `sr://games[/<room>]`; universal links cover only `/app/*`.
- Private media storage exists: `$lib/jkai/media/storage` (`saveBuffer` / `readBuffer`, file or Azure blob).
- No Android toolchain on homeserv or porkserv. GitHub-hosted Ubuntu runners carry the Android SDK.

## 3. Architecture in one picture

```
 Bravia ─ sr. tv APK (Kotlin shell: WebView, D-pad, keep-awake, self-update)
            │ loads https://strangeramblings.com/tv  (SvelteKit, built for a remote)
            │   ├─ not linked → link code; John approves it at /admin/games/tvs → `sr_tv` cookie
            │   ├─ menu: games (+ "About the site", "Leaderboard")
            │   └─ party lobby: QR → /play/<CODE>, players, kick/lock, pick game, Start
            │        └─ room running → the game's TV board (existing `toScreen` boards + new ones)
 phones ──┬─ Apple app: sr://games/join/<CODE> → joins the party as the family member → native controls
          └─ browser:   /play/<CODE> → name → guest seat → Svelte web controller for the room's game
```

The **party** is the new layer: a TV-hosted gathering that outlives individual games. A party holds the
people at the TV; starting a game makes an ordinary room (`createGame`) with those people already joined, so
**every existing rules module is reused unchanged**. Back to the lobby, pick another game, same people.

## 4. Linking a TV (only a linked TV can host)

- `/tv` is public (a TV has no login). Without a valid `sr_tv` cookie it shows **"Link this TV"** and a
  4-letter code (same alphabet as screen codes), refreshed every 20 min.
- John (owner only) types the code at **`/admin/games/tvs`** and names the TV ("Living room Bravia"). The
  TV's waiting stream receives a token; the page posts it to `/api/tv/claim`, which sets `sr_tv`
  (httpOnly, Secure, SameSite=Lax, 400 days).
- Token = `tv_<id>.<expires>.<nonce>.<hmac>` over `AUTH_SECRET` (shape of the screen ticket, context string
  `games-tv`). Linked TVs are rows in a datastore collection **`games-tvs`** (`id`, `name`, `linkedAt`,
  `lastSeenAt`, `revokedAt`) — no schema change, no GRANT. Verification = HMAC ok AND row present and not
  revoked (cached 60 s). `/admin/games/tvs` lists TVs with Revoke.
- The Bravia's own browser works too (same pages, same cookie) — the APK is a nicer wrapper, not a
  requirement.

## 5. Parties, guests and joining

**`$lib/games/party.server.ts`** (in memory, like rooms; a deploy ends parties — the TV reopens a fresh one).

- `openParty(tvId)` → one party per TV: `{ id, code, tvId, members[], locked, game, options, roomId,
  phase: 'lobby'|'playing' }`. Code: 4 consonants (`screens.ts` alphabet), unique among open parties.
- Members: `{ id, name, kind: 'family'|'guest', joinedAt, active }`, **max 8**. Family joins carry
  `playerId(email)`; guests get `v_<12 hex>` ids (a `v_` id is never an email hash).
- **TV verbs** (`sr_tv` cookie): `pick {game, options}`, `start`, `kick {memberId}`, `lock`/`unlock`,
  `end` (stop the running room, back to lobby), `close`.
- `start`: `canCreate`, then `createGame({ host: first active member, invite: the rest, options })`,
  then `act(room, id, 'join')` for each invitee and `act(room, host, 'start')` so the TV, not a phone,
  starts. Games whose `start` needs a phone choice keep their own lobby (none in v1). Player count is
  checked against the game's `minPlayers`/`maxPlayers` before creating; the menu shows each game's range.
- **Guests**: `POST /api/games/party/<CODE>/join {name}` → name passes the Quiz Night kids block layer and
  is de-duplicated ("Sam", "Sam 2") → a guest seat token (HMAC, scoped to that party id, dies with the
  party) in an httpOnly cookie `sr_seat_<partyId>`. Locked parties refuse new guests. Rate limit: 10 joins
  per IP per 10 min, 8 members per party.
- **Family on the web**: a signed-in browser with `games:self` joins as themselves (real `playerId`).
- **Apple app**: `POST /api/native/games/party/<CODE>/join` joins as the member; the app then follows the
  party's `roomId` with its existing room stream and native controls. For a game the installed app does not
  know, the app opens `/play/<CODE>` in a web view.
- **Streams** (SSE, the `roomStream` shape):
  - TV: `/api/tv/party/stream` → `{type:'party', party}` frames + `{type:'room', room: toScreen}` while a
    room runs (reuses `watch`).
  - Player: `/api/games/party/<CODE>/stream` (seat cookie or session) → party frames + that player's
    `toWire` of the running room.
  - Player moves: `POST /api/games/party/<CODE>/act {action, …}` → `act(roomId, playerId, …)`.
- **Leaderboard**: the recorder skips `v_` ids, so `game_results` stays family-only.
- **QR**: `/play/<CODE>` page first tries `sr://games/join/<CODE>` (iOS only, hidden iframe/`location`
  attempt with a 1.2 s fallback) then shows the web join form. QR rendered server-side with the existing
  `qrcode` dependency (`$lib/server/qr.ts`).

Public routes added: `/tv` (exact + `/tv/install`, `/tv/get`, `/tv/version.json`), `/play/` prefix,
`/api/tv/` prefix, `/api/games/party/` prefix. Each handler does its own auth (TV token / seat / session).
Note `HOOK_BYPASSES` is a prefix list — the new entries are scoped to exactly these prefixes.

## 6. The TV front end (`/tv`, SvelteKit)

- 1920×1080 stage scaled like `TableScreen` (cqw units), **D-pad first**: every control is a `<button>` in
  a roving-focus grid (`$lib/components/tv/focus.ts`: arrow keys move focus spatially, Enter selects,
  Back = `Escape`/`history.back`). Big focus rings, nothing needs a pointer.
- Screens: **Menu** (game tiles with player range and a one-line blurb; "About the site" panel pulling the
  public blurb + recent posts; Leaderboard), **Lobby** (QR + code, member list with kick, lock, game
  options, Start), **Board** (the game's TV board; Back opens a small "End game / Back to lobby" sheet).
- The design system throughout (DM Mono `sr.` mark, Archivo Black display, DM Sans body, JetBrains Mono
  labels, tokens) — the TV boards' existing ink stage.
- Personal frame (`$lib/games/kelly.ts`): a "made by John for the Kellys · sr." sting on load, host lines in
  John's voice, places (Darlington, the Tees, Stockton & Darlington railway). **Family first names come
  from the members list at runtime** (`listMembers().displayName`), never hard-coded in this public repo.
  No surnames beyond Kelly, no ages, schools or address.

## 7. The Android app (`zerosumpain/SR-TV`, new public repo — no secrets in it)

- Kotlin, single `MainActivity` with a full-screen `WebView` on `https://strangeramblings.com/tv`;
  `LEANBACK_LAUNCHER` intent + 320×180 banner (sr. monogram), `FLAG_KEEP_SCREEN_ON`, D-pad keys passed
  through to the page, Back → page `Escape` then exit on the menu, cookies persisted (`CookieManager`),
  hardware acceleration, autoplay media allowed. Offline/error page with Retry.
- Self-update: on launch fetch `/tv/version.json` (`{versionCode, url}`); newer → "Update" dialog →
  `DownloadManager` + package installer (`REQUEST_INSTALL_PACKAGES`). Screens are web pages, so APK updates
  are rare.
- Build: GitHub Actions on `ubuntu-latest` (SDK preinstalled), `./gradlew assembleRelease`, signed with a
  keystore held only in repo secrets, published as a GitHub Release asset `sr-tv.apk`. SR-Main
  `/tv/get` 302s to the latest release asset; `/tv/version.json` reads the latest release.
- Install guide at `/tv/install`: Developer options → allow unknown sources → install **Downloader** from
  Play → type `strangeramblings.com/tv/get`. Fallback `scripts/install-tv.sh` (homeserv: `adb connect`
  + `adb install -r`).

## 8. Web controllers (`/play/[code]`)

One Svelte controller per game in `$lib/components/games/play/<game>/`, driven by the same wire the app
reads (`toWire`) and posting the same moves. v1: Boggle, Azul, Codenames, Quiz Night (AI topic and Kelly
packs), Snap Happy, Biscuit Tower, Iron Roads. A game is listed on the TV menu only when it has a TV board
**and** a web controller (`PARTY_GAMES` in `$lib/games/party.ts`).

## 9. Games

| Game | New work |
|---|---|
| **Boggle** | `toScreen` + TV board (grid, timer, live word counts, reveal of who found what); web controller (swipe/tap path on the grid, typed fallback); bonus words = family first names (runtime) + places score double, flagged "Kelly bonus". `maxPlayers` 8 in parties. |
| **Azul, Codenames, Quiz Night** | Web controllers + party start. Boards exist. |
| **Kelly's Quiz Night** | §10. |
| **Snap Happy** (reaction) | New rules module in the Tap Duel shape. The TV flicks through original SVG pictures (Locomotion No. 1, a clock tower, a kettle, a custard cream, a red bus…); a round names a target ("Snap on the train!"). Server deals `showAt` times ahead; phones show a big SNAP button and measure the tap against `showAt` using the stream's clock skew; snapping on a decoy or early costs a point; 8 rounds; fastest correct snap scores most. |
| **Biscuit Tower** (physics) | New rules module + TV board. Turns: a crane swings an item (custard cream, bourbon, mug, teapot, a Darlington brick) above a tower; the player taps DROP on the phone. The TV runs the physics (Rapier 2D, as Marbler) and reports the outcome with its TV token (`settled` + height, or `toppled`); the TV is the authority, and a turn with no report in 10 s auto-settles. Topple = out of the round; last builder standing (or tallest after 3 rounds) wins. |
| **Iron Roads: Darlington Edition** (board) | New rules module + TV board + controller. Original North-East rail map (~20 towns, Stockton & Darlington line at its heart), coloured route cards, hidden destination tickets on each phone, claim routes, longest line bonus. 2–5 players, aimed at 30–40 min. Original names, map and card text. |

## 10. Kelly's Quiz Night

- **Packs** in a datastore collection `games-quiz-packs`: `{ id, title, subject, notes, status:
  'draft'|'approved', questions[], photos[], createdAt, updatedAt }`. Photo = `{ id, diskPath, caption,
  year? }` saved with `saveBuffer` (private storage — never `static/`).
- **`/admin/games/quiz-packs`** (owner): new pack → subject + notes + photos (each with a caption — who,
  where, when; the model reads captions, not pixels) → **Draft** runs the existing writer-then-blind-checker
  through the gateway (`$lib/llm/client`, workload `games-quiz`) for 20–30 questions, mixing text rounds and
  photo rounds ("Where was this taken?", "Which year?", "Who is this?"), four options each → John edits any
  question, removes, reorders, reattaches photos → **Approve**.
- **Play**: on the TV, Quiz Night's options gain "Kelly's Quiz Night — <pack>" (approved packs only). The
  room takes the pack's questions instead of calling the model in `prepare`. Photos are served by
  `/api/games/quiz-photo/<roomId>/<photoId>?ticket=…` — only to a screen ticket or a seat in that room.
- Existing `QuizTable` board shows the photo above the question when a question has one.

## 11. Order of work, verification

Each phase is its own SR-Main PR, merged and verified live before the next:

1. **Foundation** — TV linking, parties + guests, `/tv` menu/lobby, `/play` join, Boggle TV board +
   controller, Android app + `/tv/install`, results skip guests.
2. **Existing trio** — web controllers + party start for Azul, Codenames, Quiz Night.
3. **Kelly's Quiz Night** — packs, admin page, photo serving, play.
4. **Snap Happy**, 5. **Biscuit Tower**, 6. **Iron Roads**.
7. **Apple app** — `sr://games/join/<CODE>` (SR-AppleApp PR → TestFlight for John first; main only on his
   say-so).

Verification per phase: rules unit tests (`*.test.ts` alongside each module); party/guest/TV-token tests;
Playwright at 1920×1080 driving `/tv` with arrow keys + two `/play` browser controllers through a full game
against a local build; `gate-remote.sh`; after merge, live checks (`/tv` 200 and contains the link screen,
`/tv/get` 302 to the APK, `/play/ZZZZ` renders the "no party" message, API refuses a forged TV token).
APK: CI build artifact + `aapt dump badging` shows `LEANBACK_LAUNCHER`. The on-device test on the Bravia is
John's.

## 12. Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| App shape | native Compose UI / thin WebView shell / TV browser only | thin shell | one codebase for boards; deploys update the TV without a reinstall | yes |
| TV-first rooms | change every game's host model / a party layer over `createGame` | party layer | reuses every rules module unchanged | yes |
| Who can host | anyone / linked TVs only | linked TVs | stops a public page becoming anyone's lobby server | yes |
| TV/pack storage | new tables / datastore collections | datastore | house pattern; avoids the runtime-GRANT trap | yes |
| Family names | hard-coded / runtime from members list | runtime | SR-Main is public; kids' names stay out of git | yes |
| Address-like names | "Snap Happy at No. 20" (design draft) / "Snap Happy" | "Snap Happy" | the house number is part of the address rule | yes |
| Photo questions | vision model / captions | captions | accurate, cheap, John knows who is in the photo | yes (vision later) |
| APK hosting | static/ / GitHub release of a public SR-TV repo | GitHub release | no binaries in SR-Main; Downloader follows the 302 | yes |
| Physics authority | every phone simulates / TV simulates and reports | TV | one renderer, the TV is a linked device | yes |
| New physics lib | hand-rolled / planck / Rapier 2D | Rapier 2D | Marbler precedent | yes |
| Boggle name | rename / keep | **Kelloggle** (John, 2026-11-02) — shown everywhere; the id stays `boggle` so results, rooms and the app keep working | his call; also clears the trademark | yes |
| Guests on leaderboard | record / skip | skip | `game_results` is family-only, no anonymous rows | yes |
