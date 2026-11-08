# Family board games: longer, durable, asynchronous play

> Status 2026-10-23: row 7 (trading + hex economy) shipped as **Homestead** with the durable rooms store (see `2026-10-22-family-games-homestead.md` and `2026-10-22-family-games-durable-rooms.md`). The other rows are still ideas.

Date: 2026-10-22. Scope only, no code changed. Sources read: memory `project_family_games`,
`reference_no_apns_without_a_second_profile`, `reference_new_table_needs_runtime_grant`,
`reference_drizzle_push_rename_prompt`, the Brass & Rails and Archetype notes, and SR-Main
`src/lib/games/{rooms.server,catalogue,invite-push.server,players.server,results.server}.ts` in
`/home/john/sr-main-games-20261022` (read-only).

## 0. Where we start

- 12 games ship today (Tap Duel to Chess). Every one is a pure rules module behind `GameRules`
  (`createRoom / join / leave / start / again / advance / deadline / toWire / moves`, plus
  optional `prepare`, `revision`, `resultScore`).
- Rooms live **in memory** (`rooms.server.ts`: a `Map<string, Live>`, one `setTimeout` per room,
  one `EventEmitter` per room for SSE). A deploy ends every game. The only durable thing is the
  finished result (`game_results`).
- Caps: `MAX_PLAYERS = 5` (that already fits the family), `MAX_ROOMS = 50`, `MAX_OPEN_PER_HOST = 3`,
  invites hold a lobby for 2 minutes, closed rooms are dropped after 60 s.
- `advance(room, now, Math.random)`: the RNG is **not seeded or stored**, so a room cannot be
  replayed from its moves today.
- Push exists: `pushToEmails` + `invite-push.server.ts` (time-sensitive invite, collapse id
  `game-<room>`). Only **site-paired** phones can be pushed. There is no "your move" push yet
  (the Chess note says so).
- Liar's Dice and Chess already prove turn-based play, hidden information (per-viewer `toWire`) and
  timeouts handled by a server auto-move. Draw & Guess proves delta wires (`revision` / `since`).
- Family: five people, children under 13. Only John was fully set up at launch. Fintan, Jemima, Rory
  and Katie each need the app, a site pairing and Family Circle before they can be invited or pushed.

## 1. Candidate games (10)

Mechanics are not protected, but names, artwork, map layouts, card text and trade dress are.
Rule for every game below: **an original name, original map/board, original card text and art, and
no publisher name in code, copy or the App Store listing.** Use "inspired by" only in internal docs.
(Side note: the shipped titles "Boggle" and "Wordle Race" use other companies' marks. That is
harmless while the app stays private to the family, but rename them before anything goes public.)

| # | Style | Inspired by | Original name | Why it suits 5 | Why digital helps | Session | Async | Size |
|---|---|---|---|---|---|---|---|---|
| 1 | Route building + set collection | Ticket to Ride | **Iron Roads** (North-East rail map, Stockton & Darlington theme) | Plays well at 5 on a bigger map. One small action a turn keeps waits short | Hidden destination tickets, longest-route scoring, legal-claim checks and score keeping are all automatic. Kids can't miscount | 45-75 min live, 2-5 days async | Excellent: one action a turn | M |
| 2 | Co-operative crisis | Pandemic, Forbidden Island | **Flood Watch** (Skerne and Tees burst their banks) | Everyone wins or loses together, so nobody's child is knocked out. Each person has a role, and 5 roles fit | The game handles the deck, escalation and tracking. A "hint" button helps younger players without an adult taking over their turn | 30-60 min live, 1-3 days async | Good, but table talk is the fun part, so add preset "suggest a plan" pings | M |
| 3 | Tile laying + area scoring | Carcassonne, Kingdomino | **Wallfields** (build a walled market town) | Turns are short, and a 5-player board grows into something everyone can see | Legal placements light up, scoring of unfinished features is automatic, the board pans and zooms | 30-45 min live, 1-3 days async | Excellent | M |
| 4 | Card drafting + engine building | 7 Wonders, Sushi Go | **Grand Works** (draft cards to build a town's landmarks) | Built for 3-7. All players pick **at the same time**, so 5 players wait no longer than 2 | Passing hands and scoring by neighbour are tedious on a table and free on a phone. Simultaneous play fits async very well | 25-40 min live, 1-2 days async | Excellent: everyone picks at once, and the round moves on when the last player picks | M |
| 5 | Deduction | Cluedo, Mysterium | **The Missing Biscuit Tin** (household-themed whodunnit; a "Manor" skin for older players) | Deduction holds up at 5, and every suggestion involves the other players | Private cards and who-showed-what are hidden properly. An auto notepad helps younger players and can be turned off for older ones | 30-45 min live, 1-2 days async | Good | S-M |
| 6 | Hidden movement (1 v 4) | Scotland Yard, Fury of Dracula | **Night Mail** (a mail-train thief against four detectives) | Exactly 5 seats: 1 thief and 4 detectives. Rotating the thief role gives each child a turn as the star | The thief's position is truly hidden, the reveal turns are automatic, and nobody can peek | 30-60 min live, 2-4 days async | Good: detectives may move simultaneously | M |
| 7 | Trading + hex economy | Catan | **Dales Traders** (hex valleys: wool, stone, coal, timber, ale for adults / apples for kids) | 5 works with a larger board. Trading keeps everyone involved on every turn | Trade offers with a timeout, no arguments over the robber, fair dice. Can reuse the hex code from Archetype or Brass & Rails | 60-90 min live, 3-7 days async | Medium: trading needs offers that wait for answers | L |
| 8 | Worker placement | Lords of Waterdeep, Stone Age (lite) | **Market Day** (send family members round the town for jobs) | Blocking matters more at 5. Simple worker spots for kids, a deeper "family" ruleset for adults | Action spaces and the economy are checked for you, and an end-of-round summary explains what happened | 45-75 min live, 3-5 days async | Good | L |
| 9 | Simultaneous orders + area control, no knock-outs | Diplomacy (5-player variant), Risk-lite | **Five Shires** (secret orders each day, then everyone's orders resolve together) | Designed around 5 seats. Points for holding areas instead of knocking players out, so nobody sits out for days | Hidden simultaneous orders are impossible to run fairly on a table. One "orders due 7 pm" deadline a day is a natural family ritual | 5-10 days, 1 phase a day | Native async (that is the whole design) | L |
| 10 | Legacy / campaign wrapper | Legacy-series games, Gloomhaven-style campaigns | **The Kelly Chronicles** (a campaign spanning several games) | A family story across weeks. Unlocks reward taking part, not only winning | Permanent changes (named cities, unlocked roles, stickers) live in the database, not on torn cards | Weeks (a chapter per game night) | Yes | L (needs 1-3 first) |

Mixed-age rules for every game:
- **Free text kept to a minimum.** Use preset reactions and trade phrases, and pass anything typed
  through the Quiz Night kids block layer.
- **A kids' rules variant** (fewer card types, a visible scoring hint) chosen per player, not per
  room, where the game allows it.
- **Handicaps instead of separate games.** For example, younger players start with extra cards.
- **No knock-outs.** Anyone who would be eliminated moves into a helper role.
- **Quiet hours for pushes** (see 3.4). Deadlines never fall in a child's school night.

## 2. What we can reuse

| Asset | What to take | What not to take |
|---|---|---|
| SR-Main `GameRules` + `rooms.server.ts` | The lobby verbs, per-viewer `toWire`, `advance`/`deadline` timer model, SSE stream, `revision`/`since` deltas, the `game_results` recorder (a new game needs nothing for the leaderboard) | The in-memory map as the only store |
| Liar's Dice (`liars-dice.ts`) | Turn order, hidden hands, `autoMove` on timeout, an `auto` flag on the wire, and the guard that stops a stale or far-future `now` running a whole game in one call | |
| Chess (`chess.ts`, `chess-engine.ts`) | Clocks as of `turnStartedAt`, draw/resign as moves, `legal` sent only to the side to move. **Chess is the cheapest first user of durable rooms**: add a correspondence time control (1 day a move) | |
| Archetype (`~/archetype`, `src/engine/**`) | A pure-TS engine pattern that runs in Node. **One seeded PRNG split into named child streams** (`hash(seed, namespace)`), which is exactly what replayable durable rooms need. Hex maths. `src/engine/human.ts`'s lesson: enumerate the real legal moves from the rules, not an AI shortlist. Utility AI for **bot seats** when only 3 or 4 of the family can play | React/r3f renderer, balance lab (overkill) |
| Brass & Rails (`zerosumpain/brass-and-rails`, FROZEN, off the site) | The Darlington/railway theme and unit names (Night Mail, Pit Pony) for Iron Roads and Night Mail. Hex grid + Kenney tiles as art reference. The doctrine/genome AI idea for bots | Its code: Three.js single-file 4X, frozen and archived, not a rules module |
| Quiz Night | The kids block-list layer for any free text. The `reserveUsage` metering pattern if a game ever calls a model (e.g. Flood Watch narration) | |
| Landgrab (SR-Health) | Proof the family will play a game that runs for days, plus its "Sunday letter" summary idea for a weekly game recap | |
| `invite-push.server.ts` + `pushToEmails` | The message shape, collapse ids and `ttlSeconds` for the new "your move" push | Time-sensitive level for turn pushes |

## 3. Durable rooms design

### 3.1 Opt-in, not a rewrite
Add `durable?: { schema: number; migrate?(state, from): state }` to `GameRules`. Quick realtime
games stay in memory exactly as today. Durable games (Chess correspondence, and every board game
here) are written through to Postgres. `rooms.server.ts` keeps the in-memory `Live` as a **cache**
and treats the database as the truth.

### 3.2 Tables (new: SR-Main `schema.ts`)

```
game_room            id text PK ('g_…'), game text, schema int, phase text, host_id text,
                     state jsonb  -- the whole RoomBase, Sets as arrays, incl. rngState
                     version int  -- optimistic concurrency, +1 per accepted action
                     deadline_at timestamptz null, created_at, updated_at, finished_at null
                     side jsonb   -- sawInvite, pushed, optionKeys, round, recorded
game_room_player     room_id, player_id (the HMAC id, never an email), seat int, status text,
                     last_seen_at, last_pushed_at, PK (room_id, player_id)
game_room_move       room_id, seq int, player_id null (null = server: timeout/auto),
                     action text, body jsonb, at timestamptz, PK (room_id, seq)
```

- Use composite primary keys with **no serial ids**, so there is no sequence to forget to grant (see 3.6).
- **Write path (one transaction per action):** `select … for update` on the room → apply the move to
  the cached or loaded state → `update game_room set state, version = version + 1 where version = $n`
  → insert into `game_room_move` → commit → emit SSE → schedule push. Write the database
  **before** emitting. A failed write turns the move into a 503 ("Couldn't save that move, try
  again"). This is the reverse of `game_results`' fire-and-forget, on purpose: a lost move in a
  three-day game is worse than a refused tap.
- **Determinism:** replace `Math.random` with a seeded PRNG kept in `state.rngState` (Archetype's
  named-stream pattern). The move log can then replay any game for debugging, "how did we get
  here" history, or a rules-bug repair. It also allows **undo, by agreement**, for kids.
- Snapshot plus log means rooms load by snapshot, not replay. Replay is a tool, not the hot path.

### 3.3 Resume across deploys
- On boot (lazily on first `/api/native/games` hit, plus an eager pass from the scheduler role):
  `select … from game_room where phase not in ('closed')`, rebuild each `Live`, and re-arm timers
  from `deadline_at`.
- **Outage grace:** the server was down for part of the time, so any `deadline_at` that passed during the downtime becomes `boot + 10 min`.
  Store a `game_server_heartbeat` timestamp (one row, or reuse an existing scheduler heartbeat) so
  real clocks (Chess) can credit the downtime back instead of flagging someone.
- The phone already treats the stream dropping as "room went away". Durable rooms need it to
  **reconnect and re-fetch** instead. This is the one change to the app's shared plumbing.
- `roomsFor` and `invitesFor` read the database for durable rooms, so the app's resume row lists a
  game from three days ago.
- Caps: a separate `MAX_DURABLE_OPEN_PER_HOST` (e.g. 5), so long games don't block a quick Tap Duel.
  The 50-room cap covers live rooms only.
- Retention: finished durable rooms kept 90 days (the history is the fun), then deleted by a nightly
  job. Add the tables to whatever erase path removes a member (rooms hold player ids, not emails).
- **Trap: player ids are `HMAC(AUTH_SECRET, email)`.** Rotating `AUTH_SECRET` (it is on the VPS
  rotation list) would orphan every seat in a durable room. Either key the id on a dedicated
  `GAMES_ID_SECRET` before durable rooms launch, or write a rotation step that rewrites
  `player_id`s. `game_results` has the same issue for history.

### 3.4 Async turns and the "your move" push
- Seat states per room: `to-move`, `waiting`, `done-this-round` (simultaneous games).
  `toWire` already tells the phone whose turn it is. Add `turn: { playerIds, deadlineAt }`
  to every durable wire.
- **Push on becoming to-move** through `pushToEmails`: category `game`, thread `game-<room>`,
  collapse id `turn-<room>` (replaces itself, never stacks), **level `active`, not time-sensitive**,
  `ttlSeconds` = time to the deadline. Body: "Your move in Iron Roads, Rory claimed York to Leeds".
  Lobby invites for durable games stay as they are but hold the lobby 24 h, not 2 min.
- **Quiet hours** (Europe/London): no turn pushes 20:00-07:30 for children, 22:30-07:00 for adults.
  Pushes held overnight go out as one "you have 2 moves waiting" at 07:30. Set per player in the app;
  the server applies it.
- **Reminders:** one nudge at 50% of the deadline and one at 2 h before it. The host can tap
  "Nudge" once an hour.
- **Pull is the floor:** the 5 s foreground poll still lists waiting turns. Players without a
  site-paired phone (most of the family today) get no push until they pair. Getting all five
  paired is a **prerequisite to make sure is done, not a code task.**
- A "Your turn" badge on the Games tab: count of rooms where `to-move` includes me.

### 3.5 Turn deadlines
- Per room, chosen at create: Live (90 s a turn), Evening (10 min), Daily (24 h), Weekend (48 h).
- On expiry: the game's `autoMove` (as Liar's Dice does): a safe, simple move such as drawing cards
  or passing, marked `auto` on the wire. Three auto-moves in a row hand the seat to a **bot** (Archetype-style utility AI) until the player returns. Nobody is kicked; the game never stalls.
- Simultaneous games (Grand Works, Five Shires): the round resolves at the deadline **or** when the
  last order is in, whichever is first.
- Deadline arithmetic must run through the existing NaN/far-future `now` guards in `advance`.

### 3.6 Release traps (all from memory, all hit before)
- **Runtime GRANT:** SR-Main runs as `sr_main_runtime`. New tables get **no grant**. The deploy is
  green and the first read 500s (`game_results` lost a month of games this way, and its
  **sequence** cost another evening). For each new table:
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_room, public.game_room_player, public.game_room_move TO sr_main_runtime`.
  No serial columns means no sequence grant, but run the sequence-gap checker anyway. Record it in
  `scripts/migrations/<date>-game-rooms-runtime-grant.sql` (only applied if the role exists), and
  add the tables to SR-Infra `registry/runtime-tables.json`. **Do not** run the full
  `runtime-grants.py | psql` render (it revokes grants the registry lacks). Apply the grant
  straight after the deploy and **before** the app PR that uses it ships.
- **drizzle push:** a creates-only diff does not prompt. Check the checkout is current with master
  first, or a stale schema makes a create-plus-drop pair and CI hangs on the rename prompt.
- **A game ships in two repos:** the SR-Main PR plus the SR-AppleApp PR must both be MERGED, and a
  TestFlight run must have built the app sha.
- **Routes:** new `/api/native/games/*` routes need `.github/public-routes.txt` + `native-auth.test.ts`.
  No new access *area* (reuse `games:self`), so the byte-copied `$lib/access/catalogue.ts` and its
  four-repo PR fan-out are not triggered. Keep it that way.
- **Merge = auto-deploy = ends live in-memory games.** Before durable rooms exist, merge outside family game time.

## 4. Recommendation and build order

**First two games**
1. **Iron Roads** (route building). Simplest rules that still fill an evening, one action a turn
   (ideal for async), hidden tickets reuse the Liar's Dice per-viewer pattern, the railway theme
   reuses Brass & Rails' identity, and it plays well from about age 7 up. It exercises everything durable
   rooms need: turn order, hidden information, long deadlines, push.
2. **Flood Watch** (co-operative). The opposite shape: a shared win or loss, roles, and no child
   losing to a parent. It tests a "team result" through the leaderboard (`resultScore` null, a
   shared outcome) and the hint system. Close runner-up: **Grand Works** (drafting) if the family
   prefers competition. It is the best test of simultaneous async turns, so build it third
   either way.

**Phases**

| Phase | Deliverable | Proves | Size |
|---|---|---|---|
| 0 | Family set-up: all five on the app, site-paired, in Family Circle. Choose quiet hours | Push can reach the children at all | Ops, no code |
| 1 | Durable room store: 3 tables + grant migration, `durable` opt-in, seeded RNG, write-through, boot rehydrate, outage grace, app reconnects instead of "room went away". **First user: Chess correspondence (1 day a move)** | A game survives a deploy | M |
| 2 | Async layer: `turn` on the wire, "your move" push, quiet hours, nudges, deadline presets, auto-move, then bot seat, "Your turn" badge, durable lobby (24 h invites) | A game survives a week | M |
| 3 | Iron Roads (rules module + tests + iOS board view with pan/zoom) | The first real board game | M |
| 4 | Flood Watch (co-op, roles, hints) | Co-op + team results | M |
| 5 | Grand Works (simultaneous drafting) | Simultaneous async rounds | M |
| 6 | Pick from Wallfields / Night Mail / Missing Biscuit Tin by what the family enjoyed | | S-M each |
| 7 | Five Shires, Dales Traders, Market Day | Heavier async strategy | L each |
| 8 | Kelly Chronicles campaign layer across 3, 4, 7 | Persistence across games | L |

Several phases can run in parallel workflows **once Phase 1's `GameRules.durable` contract is
merged**: rules modules for 3, 4 and 5 are pure and testable in Node without the store. Their iOS
views and the Phase 2 push work only touch separate files. Do not start game PRs until the Phase 1
contract is frozen, or each game will invent its own persistence.

Open questions for John: (a) do the kids get their own phones/pairings, or play on a shared iPad
(this changes "seat = phone" to "seat = profile")? (b) quiet-hour times; (c) whether a web board
(`/games/[id]`) should be in scope for long games. A laptop screen suits Iron Roads' map better
than a phone.
