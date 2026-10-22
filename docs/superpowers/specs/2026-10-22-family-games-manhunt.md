# Family games: Manhunt

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/manhunt.ts`, catalogue entry `manhunt`, the parent check in `api.server.ts`), SR-AppleApp (`Games/Manhunt*.swift`). Real-world hide-and-seek on a map: one runner, everyone else hunts. The mechanics are inspired by the classic chase-across-the-city board game, but the name, wording and content are our own.

## The game

Three to eight players. One is the **runner**, the rest are **hunters**. The host draws a circle centred on where their phone is (radius 250 m to 2 km, to the nearest 10 m; default 500 m) and picks a length (15 to 60 minutes; default 30). The host may pick the runner in the lobby; otherwise the start draws one at random. "Play again" passes the runner's role to the next player round the table.

1. **Lobby.** The host's phone sends its position as the circle's centre (`area`). Start needs a centre and three joined players.
2. **Countdown** (3 s), then **head start** (2 min). Phones send positions, but nobody sees anybody: the runner gets away.
3. **Hunt** (the length the host picked, from the end of the head start).
   - Hunters see each other **live**.
   - Hunters see the runner only at a **ping**, and **live** from any runner fix outside the circle until 30 s after the last one outside.
   - The runner sees the hunters only at the same pings (where each hunter was at that moment). The runner never sees a hunter live.
   - A hunter close enough taps **Catch**. The runner confirms it, or the server accepts it after 20 s. The catcher wins.
   - The runner wins if the clock runs out.
4. **Finished.** Standings, then the room waits ten minutes for "Play again".

### Difficulty: how often the runner shows up

| Level | Ping every |
|---|---|
| easy | 5 min |
| medium | 3 min |
| hard | 2 min |

So "hard" is hard for the runner. No ping lands on the final whistle (a 15-minute hard game pings at 2, 4 ... 14).

### Who may host

Only a **parent** (`family:admin`, shown as "Parent" in /admin/access) or the **owner** may host. It is checked on the server in `api.server.ts`, which both doors (native and web) use: at create, and again for every set-up action (`start`, `again`, `area`, `runner`), because the host seat passes to another player when the first host leaves mid-game. A member who is not a parent gets 403 "Only a parent can host Manhunt." Playing (positions, catch, confirm) needs only `games:self`.

### Outside the circle

A fix is outside when its distance from the centre, less its own accuracy (capped at 25 m), is more than the radius. GPS jitter on the line does not expose a runner standing on it; rough GPS buys no more than 25 m.

### The catch rule

A hunter's claim succeeds when:

- the hunter is in the hunt, it is the hunt phase, and nobody else has a claim standing;
- the hunter's own latest fix is under 30 s old (server time) and no rougher than 50 m;
- the distance between the hunter's fix and the runner's latest fix is at most **25 m plus the larger of the two accuracy radii, the extra capped at 25 m**. Two sharp fixes (5 m) must be within 30 m; no pair is ever accepted beyond 50 m.

A claim that is too far costs that hunter a 30 s wait before trying again (the refusal says how long). The wait is the hunter's own and nobody else is told of it. This limits using Catch as a distance probe; in practice a hunter claims when they can see and reach the runner.

If the runner's phone has **gone quiet** (no fix for 60 s during the hunt, or none since the hunt began), a claim skips the distance check: switching the phone off must not make the runner uncatchable. Everyone is told the runner has gone quiet (not where they are).

A standing claim lasts 20 s: the runner's Confirm ends the game at once; otherwise the server accepts it at the deadline. A claim made before the clock runs out is settled first, even if its 20 s run past the end. There is no "dispute": the server has already checked the distance, and a dispute button in a children's game is an argument button.

## Positions: safety and privacy

- Positions are moves (`position {lat, lng, accuracy, at}`) and live **only in the in-memory room**. They are never written to journeys, location history, the database or a log line. `game_results` records names, ranks and wins; the recorder reads `radius`, `minutes` and the `about` label, and the centre arrives as options `lat`/`lng` that the room keeps only inside `area`, which the recorder never reads (a test proves it).
- A finished or closed room drops every fix and every ping at once. A player who leaves has their fix dropped at once. A deploy ends every room and its positions with it.
- Rate limit: a phone's fixes closer together than 3 s (server time) are ignored. A fix more than 60 s old on arrival is ignored; one stamped in the future, or with no time, is taken as now. A place off the map (lat outside ±90, lng outside ±180, not a number) or an accuracy that is negative or not a number is 400.
- Positions are taken only from players in the hunt during the head start and the hunt. Anything else is dropped without a word.
- The app collects game positions only while the room is in the head start or hunt, from the moment the game screen sees that phase (it keeps going with the phone in a pocket, the blue location pill showing). It stops at the finish, on Leave, when the room closes or goes away, and when the screen is closed. It is a separate location session from family sharing, an explicit exception to "GPS sleeps when still" for the game only, and its fixes never enter the journey outbox.

## Moves (`POST /api/native/games/<id>`)

| Body | Who / when | Does |
|---|---|---|
| `{ action: "area", lat, lng, radius?, minutes? }` | host, lobby (parent check) | Centres the circle; radius and length optional. |
| `{ action: "runner", playerId \| null }` | host, lobby (parent check) | Picks the runner; null draws one at the start. |
| `{ action: "position", lat, lng, accuracy, at }` | anyone in the hunt, head start and hunt | A fix; see the rate limit above. |
| `{ action: "catch" }` | a hunter, hunt | Claims the catch (400 with a sentence: too far, cooldown, no fresh fix; 409: wrong phase or a claim already standing). |
| `{ action: "confirm" }` | the runner, a claim standing | Owns up: the catcher wins. |

Create (`POST /api/native/games`): `{ game: "manhunt", difficulty, invite, lat?, lng?, radius?, minutes? }`. Up to seven invitees (the registry reads `GameRules.maxPlayers`; the shared five is unchanged for every other game).

## Wire (`toWire`)

Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `phaseEndsAt`, `players`, `standings`, `winnerIds`, `serverNow`):

- `myRole`: `runner` \| `hunter` \| null (not in the hunt).
- `area: { lat, lng, radiusM } | null`, `radius`, `minutes`, `rule` (one sentence), `pingMs`, `headStartMs`, `catchM`, `catchSlackM`, `claimMs`, `outsideLiveMs`, `fixMinGapMs`.
- `runnerPick` (lobby only), `runnerId`, `startedAt` (head start), `huntStartedAt`, `endsAt`, `nextPingAt`.
- `runnerLiveUntil`: set while the runner is live to the hunters; everyone is told that, not where.
- `runnerQuiet`: the runner's phone has gone quiet.
- `claim: { hunterId, deadline, quiet } | null`.
- `catchCooldownUntil`: mine only.
- `pings: [{ at, runner, hunters }]` during the hunt: a hunter gets `runner` (the runner's fix at the ping) and `hunters: []`; the runner gets `runner: null` and `hunters: [{ id, fix }]`; anyone else gets neither.
- Each player: `id`, `name`, `status`, `isHost`, `seated`, `role`, `fix` — my own always while I am in the game; for a hunter in the hunt, every hunter's, and the runner's only while live; otherwise null.
- A fix on the wire: `{ lat, lng, accuracy, at, outside }`.
- `result: { outcome, catcherId, confirmed } | null`, outcome `caught` \| `time` \| `runner-left` \| `hunters-left`.
- `phase`: `lobby` \| `countdown` \| `headstart` \| `hunt` \| `finished` \| `closed`. `phaseEndsAt` in the hunt is `endsAt`.

`manhunt.test.ts` builds the wire for every player, serialises it, and searches the JSON for the other players' coordinates in each phase.

## Timeouts and leaving

- Nothing waits on a person. The head start, every ping, the 30 s live window, the claim's 20 s and the end are deadlines on the room's own timer; `advance` takes them in order, anchored to the schedule, with a loop cap and a NaN guard (`advance(room, NaN)` does nothing).
- A stalled phone: a hunter who stops sending is just not seen; a runner who stops sending goes quiet (above) and the claim is accepted at 20 s without them.
- Leaving: the runner leaving ends it for the hunters still in (outcome `runner-left`, they share the win, nobody is the catcher). The last hunter leaving ends it for the runner (`hunters-left`). A hunter's own standing claim goes with them. The host leaving the lobby cancels it; the last player out closes the room.

## Leaderboard

Standings: winners first, then the rest of the winning side, then the losers. Each row is `{ id, name, place, role, result: won|team|lost, left }`; no `score`, so the board ranks by wins. A catch gives **the catcher** the win (the other hunters are `team`, not a leaderboard win); time or the hunters leaving gives the runner the win; the runner leaving gives every hunter still in the win.

## Not built

- Real GPS can only be tested on a device, outdoors. The server and the app's logic are unit-tested with fixed coordinates; the `-SRDemo` fixtures show the map with made-up positions. Nothing in CI or the simulator walks.
- No push for pings or a claim: the phones are in pockets on the move, but the app hears the room only while its screen (or background session) is open. A "you have been pinged" push wants the APNs delivery path.
- No dispute of a catch, no in-game chat, no shrinking circle, no hiding-spot rules, no web play (the web lobby says "open in the app").
- No safety geofence beyond the circle: the circle is a play boundary, not a guarantee. Parents set the area; the app tells the runner when they are outside.
