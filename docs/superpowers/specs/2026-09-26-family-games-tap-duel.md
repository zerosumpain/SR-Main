# Family games — Tap Duel (first game)

Status: building 2026-09-26. Repos: SR-Main (`/api/native/games`), SR-AppleApp (Games tab).

## What

A realtime reaction game for 1–5 family members on the iPhone app. The person who starts a
game picks the difficulty and may invite family; invitees get a notification they tap to join.
This is the first of a family-games series (Wordle race, jkai quiz night next), so the room /
invite / stream plumbing is game-agnostic and Tap Duel is its first rules module.

## Shape

- **Server-authoritative rooms, in memory.** Prod is one node process (`server-with-ws.mjs`,
  no replicas) and the site already keeps short-lived state in memory (`sitePairCodes`). A room
  lives minutes; a restart ends games in progress. No table — results are per game only.
- **Transport: POST in, SSE out** (WebSockets are banned in `server-with-ws.mjs`). Room stream
  copies `api/research/[id]/stream` (replay on connect, 15 s keepalive, `X-Accel-Buffering`).
- **Gate: new access area `games`** (`games:self`), routes on `withNativeAccess('games', …)`.
  Owner always; members via /admin/access groups. Family Circle's seed gains `games:self`;
  prod's existing group row is updated once by hand (seed runs on first read only).
- **A games-only member needs a site credential**, so the auto site-pairing condition widens
  from `chat|news` to `chat|news|games` (site: `sitePairFor`, `/api/native/pair`; app:
  `wantsSitePair`, `signsOutSite`).

## API (all `withNativeAccess('games')`)

| Route | Does |
|---|---|
| `GET /api/native/games` | `{ me, players, invites, rooms, serverNow }` — the lobby poll |
| `POST /api/native/games` | `{ game:'tap-duel', difficulty, invite:[playerId] }` → `{ room }` |
| `GET /api/native/games/[id]` | `{ room }` snapshot |
| `POST /api/native/games/[id]` | `{ action: join\|decline\|leave\|start\|tap\|again, round?, reactionMs?, early? }` → `{ room }` |
| `GET /api/native/games/[id]/stream` | SSE `data: {"type":"room","room":…}` on every change |

A player id is an opaque hash of the email. Players = everyone else with a live site device who
is the owner or holds `games:self`; names from the household row, else the email's local part.

## Tap Duel rules

5 rounds. Each round the server fixes `goAt` (epoch ms) and a list of decoy flashes before it,
and sends them AHEAD, so every phone turns green at the same instant regardless of latency. The
phone measures reaction time locally (monotonic clock from green shown to tap) and posts it;
tapping before green (incl. during a decoy) is a false start. Under 100 ms counts as a false
start (anticipation). The round closes when everyone answered or at `goAt + window + 1 s`.
Fastest valid tap wins the round (+1). Most rounds wins; tie → lower average. Solo is the same
game with your times as the result.

| Difficulty | Wait before green | Decoys | Window |
|---|---|---|---|
| easy | 2–4 s | none | 2000 ms |
| medium | 1.5–5 s | 0–1 | 1200 ms |
| hard | 1–6 s | 1–2 | 800 ms |

Lifecycle: `lobby` (3 min to start, invites visible) → `countdown` (3 s) → per round `armed` →
`result` (2.5 s) → `finished` (kept 10 min; host can `again`, which re-invites) → gone.

## Invites and notifications

No APNs certificate, so invites are PULL. While the app is foregrounded the phone polls
`GET /api/native/games` every 5 s; a new invite raises a local notification (category `game`,
`userInfo.roomId`) that shows as a banner and opens the room when tapped. The Games tab lists
pending invites too. A phone with the app closed sees nothing until it is opened — the copy
must not imply otherwise. Real push is a later delivery adapter (needs an APNs key + profile).

## Decision Log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| Room state | table / memory | memory | one process; minutes-long; results per game only | yes — add a table later |
| Lane | companion pilot / site `/api/native` | site | SSE, member identity, no hand-released pilot change | yes |
| Fairness | server timestamps / client-measured | client-measured reaction + server-fixed `goAt` | latency drops out; family trust model | yes |
| Invite delivery | poll / pilot alert queue / APNs | 5 s foreground poll | only realtime option without a certificate (John: build it first) | APNs adapter later |
| Format | best-of-7 first-to-4 / fixed 5 | fixed 5 rounds | same flow solo and multi | constant |
| Difficulty | per player / per game | per game, host picks | John's call | — |
| Tab | Family section / own tab | own Games tab | series of games coming | yes |

## Wire shapes (the contract both repos build against)

```jsonc
// GET /api/native/games
{ "me": {"id":"p_…","name":"John"},
  "players": [{"id":"p_…","name":"Sam"}],            // invitable: everyone but me
  "invites": [{"roomId":"g_…","game":"tap-duel","difficulty":"easy","hostName":"John",
               "players":["John","Sam"],"expiresAt":1790000000000}],
  "rooms":   [{"id":"g_…","game":"tap-duel","phase":"lobby","hostName":"John"}], // rooms I've joined, not closed
  "serverNow": 1790000000000 }

// Room — body of {room} and of every SSE frame {"type":"room","room":…}
{ "id":"g_…", "game":"tap-duel", "difficulty":"easy|medium|hard",
  "phase":"lobby|countdown|armed|result|finished|closed",
  "hostId":"p_…", "meId":"p_…", "rounds":5,
  "players":[{"id":"p_…","name":"Sam","status":"invited|joined|declined|left","score":0,"isHost":false}],
  "phaseEndsAt": 1790000000000,          // countdown end, result end, lobby expiry; null when open-ended
  "round": null | { "number":1, "goAt":…, "windowMs":2000, "closesAt":…,
                    "decoys":[{"at":…,"ms":350}],
                    "responses":[{"playerId":"p_…","reactionMs":231,"early":false}], // armed: who has answered (reactionMs null until result)
                    "winnerId": null },
  "standings": null | [{"id":"p_…","name":"Sam","score":3,"bestMs":198,"avgMs":240,"falseStarts":1}],
  "winnerIds": [],                        // finished: ties share
  "serverNow": 1790000000000 }
```

Errors are `{error}` with a status: 404 unknown/expired room, 403 not in the room / not host,
409 wrong phase (e.g. tap for a closed round).

## Game 2 — Family Wordle Race (added 2026-09-26)

Same rooms, invites, lobby verbs and stream; `POST /api/native/games {game:'wordle-race', …}`.
Everyone gets the same secret; 6 guesses; the game ends when everyone has solved or run out, or
at the time limit. Solved first, then fewest guesses, then fastest. Other players' rows travel as
colours only — the social hook — and everything is revealed when the game finishes.

| Difficulty | Secret from | Time | Hard mode |
|---|---|---|---|
| easy | 500 commonest | 5 min | no |
| medium | 1,000 commonest | 4 min | no |
| hard | all 1,405 | 3 min | greens stay put, found letters stay in (with their counts) |

Move: `POST /api/native/games/[id] {action:'guess', word}`. 400 for a non-word / wrong length /
hard-mode breach (the sentence is for the player: "Not in the word list.", "2nd letter must be
R.") — a refused guess costs nothing. 409 once solved, out, or out of time.

```jsonc
{ "id":"g_…", "game":"wordle-race", "difficulty":"easy|medium|hard",
  "phase":"lobby|countdown|playing|finished|closed",
  "hostId":"p_…", "meId":"p_…",
  "wordLength":5, "maxGuesses":6, "timeLimitMs":300000, "hardMode":false,
  "startedAt": 1790000000000,            // null before play
  "phaseEndsAt": 1790000000000,          // lobby expiry, countdown end, TIME LIMIT while playing, finished expiry
  "players":[{ "id":"p_…","name":"Sam","status":"joined","isHost":false,
               "guessCount":2,"solved":false,"done":false,"solveMs":null,
               "rows":[{"word":null,"marks":["absent","present","correct","absent","absent"]}] }],
               // word is the letters for ME always, for others only once finished
  "keyboard": {"a":"absent","r":"present","e":"correct"},   // my best mark per letter
  "secret": null,                        // the word once finished
  "standings": null | [{"id":"p_…","name":"Sam","solved":true,"guesses":4,"solveMs":83000}],
  "winnerIds": [],
  "serverNow": 1790000000000 }
```

## Game 3 — jkai Quiz Night (added 2026-09-26)

The host picks a **topic** (free text ≤60 chars, or blank = jkai picks), an **audience**
(`kids` ≈7–11, `family` default, `adults`) and a difficulty (seconds per question: easy 20,
medium 15, hard 10). jkai writes the questions ONCE, while the lobby fills; the lobby shows
`prep: writing → ready | failed` and Start is refused (409, a sentence) until `ready`. 10
questions (min 6), four options, server-marked: a right answer scores 500 + up to 500 for speed
(server clock from when the question opened), a wrong one 0. Everyone answering reveals early;
the reveal lasts 4 s. "Play again" is a NEW quiz (the phone POSTs create with the same
settings); `again` answers 409.

- Create: `POST /api/native/games {game:'quiz-night', difficulty, invite, topic?, audience?}`.
  A member may start 10 quizzes per rolling 24 h (429 with a sentence); the owner is uncapped.
- Move: `POST /api/native/games/[id] {action:'answer', question:<index>, choice:0-3}`.
- Model: workload `games-quiz` (follows the site default; settable at /admin/ops/costs), reasoning
  off, JSON mode, one resample. Output is screened (shape, distinct options, repeats, a whole-word
  family-safety block list) and options are shuffled server-side.

```jsonc
{ "id":"g_…", "game":"quiz-night", "difficulty":"easy|medium|hard",
  "audience":"kids|family|adults", "topic":"space" /* or null */, "title":"The Solar System",
  "phase":"lobby|countdown|question|reveal|finished|closed",
  "prep":"writing|ready|failed", "prepError": null,
  "hostId":"p_…", "meId":"p_…", "questionCount":10, "timeMs":20000,
  "players":[{"id":"p_…","name":"Sam","status":"joined","score":1450,"isHost":false}],
  "phaseEndsAt": 1790000000000,           // lobby expiry, countdown end, the question's clock, reveal end
  "question": null | {
     "index":0, "prompt":"…", "options":["…","…","…","…"], "startsAt":…,
     "answeredIds":["p_…"],                 // who has answered — never what — while open
     "myChoice": 2 /* or null */,
     "answerIndex": null,                   // set in reveal
     "explain": null,                       // set in reveal
     "picks": [] },                         // reveal: [{"playerId","choice","points","ms"}]
  "standings": null | [{"id","name","score","correct","avgMs"}],
  "winnerIds": [], "serverNow": 1790000000000 }
```
