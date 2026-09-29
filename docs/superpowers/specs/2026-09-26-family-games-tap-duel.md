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

Review changes (same day): scores move only at the reveal (a jump would give an answer away);
every create refusal is checked before a member's quiz cap is charged; the topic is refused (400)
if it fails the block list and is quoted as JSON to the model; the block list has a stricter
`kids` layer and undoes l33t/asterisk dodges; each model call has a 60 s timeout. Every invite in
`GET /api/native/games` gains `about` — one line, e.g. `"The Solar System · for kids"`, null for
games with nothing to say.

## Games 4–6 (added 2026-09-26)

Same rooms, invites, lobby verbs and stream for all three; `again` resets to a lobby.

### Anagram Blitz — `game:'anagram-blitz'`
Same 7 shuffled letters for everyone (from a 7-letter seed). Find 3–7 letter words (4+ on hard);
3→1, 4→2, 5→4, 6→6, 7→10 points; at the finish a word only one player found scores double
(not solo). Time: easy 150 s, medium 120 s, hard 90 s; ends on the clock only.
Move `{action:'word', word}` — 400 "Use only the letters you have." / "Words need at least N
letters…" / "Not in the word list." (free); 409 "You already have that one." / time's up.
```jsonc
{ "game":"anagram-blitz", "phase":"lobby|countdown|playing|finished|closed",
  "letterCount":7, "minLength":3, "points":{"3":1,"4":2,"5":4,"6":6,"7":10},
  "timeLimitMs":150000, "startedAt":…, "phaseEndsAt":…,   // the limit while playing
  "letters":["t","r","e","n","i","a","p"],               // null before play
  "players":[{"id","name","status","isHost","wordCount":3,"score":7,
              "words": null | [{"word":"paint","points":4,"unique":null}]}],  // mine always; everyone's at finish
  "seed": null, "found": null | [{"word","points","finderIds":[…],"unique":true}],
  "missed": null | ["pertain", …],
  "standings": null | [{"id","name","score","words","longest"}], "winnerIds": [], "serverNow":… }
```

### Quick Maths Sprint — `game:'maths-sprint'`
60 s; one dealt sequence of 200 problems, same order for everyone, each at their own pace,
getting harder within the band (easy + − ≤20, medium + − ≤100 and × to 10, hard + − ≤1000,
× to 12, exact ÷, `a × b ± c`). Right +1 and next; every 5th in a row +1 bonus; wrong = a miss,
streak reset, SAME problem stays. Text uses ` + `, ` − ` (U+2212), ` × `, ` ÷ `.
Move `{action:'answer', index:<my current>, value:<int>}` — 400 non-integer (free), 409 stale index.
```jsonc
{ "game":"maths-sprint", "phase":"lobby|countdown|playing|finished|closed",
  "timeLimitMs":60000, "problemCount":200, "streakBonus":5, "startedAt":…, "phaseEndsAt":…,
  "players":[{"id","name","status","isHost","score":8,"answered":7}],
  "me": null | {"problem": null | {"index":3,"text":"7 × 8"}, "score","correct","misses","streak","bestStreak"},
  "standings": null | [{"id","name","score","correct","misses","bestStreak"}], "winnerIds": [],
  "recaps": null | [{"playerId","problems":[{"index","text","answer","solved","wrongTries"}]}],
  "serverNow":… }
```

### Sequence Memory — `game:'sequence-memory'`
Simon-style on 4 / 6 / 9 tiles. Round n plays the first 2+n steps of one growing sequence. `show`
phase: the whole round's flashes are sent AHEAD with server times (step 700/550/400 ms, gap 150,
first flash 1 s after dealing) so phones flash in sync; `input`: window 2 s + 800 ms × length.
Each alive player submits once: `{action:'attempt', round, taps:[tile,…]}` (accepted from dealing;
a short attempt counts as wrong so a phone can submit on its first mistake). Wrong/missing ⇒ out.
2 s `result`. Ends when nobody is alive or at length 20; last standing win (ties share); solo =
best length.
```jsonc
{ "game":"sequence-memory", "phase":"lobby|countdown|show|input|result|finished|closed",
  "tiles":4, "startLength":3, "maxLength":20, "phaseEndsAt":…,
  "players":[{"id","name","status","isHost","playing":true,"alive":true,"best":5,"roundsSurvived":3,"outRound":null}],
  "round": null | {"number":1,"length":3,"showAt":…,"stepMs":700,"gapMs":150,
     "steps": [{"tile":2,"at":…,"ms":700}] /* NULL during input */,
     "inputAt":…,"windowMs":4400,"inputEndsAt":…,"closesAt":…,
     "answeredIds":[…], "attempts": null | [{"playerId","taps":[…]|null,"correct":true}],
     "survivorIds": null | […]},
  "standings": null | [{"id","name","best","roundsSurvived","outRound"}], "winnerIds": [], "serverNow":… }
```

## Game 7 — Boggle (added 2026-09-28)

`game:'boggle'`. A grid of letter dice, the same roll for everyone; trace words through
touching tiles (8 directions, each tile once per word) before the clock runs out.

**The host picks the round** on create (all optional, defaults in bold):
- `size`: **4** (16 classic dice) | 5 (25 Big Boggle dice) | 6 (36 dice, some with two-letter
  faces: an, er, he, in, th — and `qu` everywhere a Q would be).
- `seconds`: 30 | 90 | **120** | 180.
- `scoring`: **`classic`** — a word two or more players found is crossed out for all of them
  (the real Boggle rule; solo is exempt) | `every` — every word counts for whoever found it.

**Difficulty** = how kind the roll is, and the shortest word:
easy 3+ letters and the dice are rerolled until the board is rich in common words;
medium 3+ letters, any board that is not a dud; hard 4+ letters, any board that is not a dud.

**Points** by length in letters (`qu` is two): a point a letter past two — 3 → 1, 4 → 2, 5 → 3, 6 → 4 and so on, uncapped. The room sends the whole table (3–16).

Move `{action:'word', word, path?:[tileIndex,…]}` — the phone sends the tiles it traced
(row-major indices); the server uses a valid path that spells the word, else finds one itself,
so a typed word works too. 400 "Words need at least N letters." / "That word isn't on the board."
/ "Not in the word list." (all free); 409 "You already have that one." / time's up. 1 s grace.

Wire (GameRoom additions; lobby verbs, invites, stream as every other game):
```jsonc
{ "game":"boggle", "phase":"lobby|countdown|playing|finished|closed",
  "size":4, "scoring":"classic", "minLength":3,
  "points":{"3":1,"4":1,"5":2,"6":3,"7":5,"8":11},     // "8" means 8 or more
  "timeLimitMs":120000, "startedAt":…, "phaseEndsAt":…,  // the limit while playing
  "grid": null | ["t","qu","e","a", …],                   // size×size faces, row-major, lowercase; null before play
  "players":[{"id","name","status","isHost","wordCount":3,"score":4,
              "words": null | [{"word":"quiet","points":2,"shared":null,"path":[1,2,6,5,9]}]}],
              // mine always; everyone's at the finish, when `shared` is true/false
              // and a crossed-out word's `points` is 0
  "found":  null | [{"word","points","finderIds":[…],"shared":false,"path":[…]}],  // finished
  "missed": null | [{"word","points","path":[…]}],    // finished: the best common words nobody found (≤ 10)
  "possible": null | {"words":187,"points":260},      // finished: every valid word the board held
  "standings": null | [{"id","name","score","words","longest"}], "winnerIds": [], "serverNow":… }
```
`score` mid-game is the raw points so far (crossing-out only happens at the finish).
The invite's `about` reads "5×5 · 2 minutes" (+ " · every word counts").

## Game 8 — Categories (added 2026-09-29)

`game:'categories'`. Scattergories-style: one letter and one card of categories, the same for
everyone; write an answer to each category that starts with the letter before the clock runs out.
No model is called — the card comes from a curated list (`words/categories.ts`, 187 family-safe
prompts) and the checking is a letter test plus the family's own vetoes.

**The host picks the round** on create (all optional, defaults in bold):
- `categoryCount`: 6 | **8** | 10.
- `seconds`: 90 | **120** | 180.

**Difficulty** = the letter pool: easy `abcdefghlmnprstw`; medium adds `i j k o u v`;
hard is everything but X and Z. "Again" never repeats the last letter, and keeps the last
card's categories off the next card.

Moves, while `playing` (1 s grace after the limit):
- `{action:'answer', index, text}` — upsert my answer to category `index`; `""` clears it.
  Trimmed, whitespace collapsed, cut to 40 characters. A wrong letter is accepted (the review
  shows it, it scores 0). 400 "That isn't one of the categories." / "An answer is some text.";
  409 time's up / not started.

Then a **review** (60 s, `phaseEndsAt` its end), skipped when only one player is still in:
- `{action:'veto', playerId, index}` / `{action:'unveto', playerId, index}` — idempotent.
  400 "You can't veto your own answer." / "There is nothing there to veto."; 409 outside review.
  An answer is **struck** once its vetoes reach half the *other* joined players, rounded up
  (2 players: the other's one veto). A leaver's vetoes stop counting and the bar drops with them.
- `{action:'done'}` — ends the review as soon as every joined player has sent it (or the last
  undecided one leaves).

**Checking** (at review and finish): an answer is normalised — lower case, accents off,
punctuation gone, a leading "a"/"an"/"the" dropped — and must start with the letter.
Two or more contenders writing the same normalised answer (spaces ignored) for the same
category are all `shared` (solo: never). Status order: `empty`, `wrong-letter`, `struck`,
`shared`, `ok`. **1 point per `ok`.** Standings/winners as Boggle's (score, then categories
filled; nobody wins alone or on nothing; ties share).

Wire (GameRoom additions; lobby verbs, invites, stream as every other game):
```jsonc
{ "game":"categories", "phase":"lobby|countdown|playing|review|finished|closed",
  "categoryCount":8, "timeLimitMs":120000, "reviewMs":60000, "maxAnswer":40,
  "startedAt":…, "phaseEndsAt":…,                 // the limit while playing, the review's end in review
  "letter": null | "b",                            // lower case; null before play
  "categories": null | ["An animal", "A food", …],
  "players":[{"id","name","status","isHost","filled":3,"done":false,"score":2,
              "answers": null | [{"index":0,"text":"Badger","status":"ok",
                                  "points":1,"vetoes":0,"strikeAt":1,"vetoed":false}]}],
              // playing: mine only, `status` null, `score` 0; others null (just `filled`).
              // review/finished: every contender's, judged; `vetoed` = I vetoed it.
  "standings": null | [{"id","name","score","filled"}],   // finished
  "winnerIds": [], "serverNow":… }
```
The invite's `about` reads "8 categories · 2 minutes".

## Game 9 — Liar's Dice (added 2026-09-29)

`game:'liars-dice'`. Perudo-style: everyone rolls dice under a cup, bids on what the WHOLE table
holds, and calls "liar" on a bid they don't believe. The first turn-based, hidden-information
game — the per-viewer `toWire(room, meId, now)` is what keeps each cup private; `rooms.server.ts`
is unchanged.

**The host picks the table** on create (optional, default in bold): `dice`: 3 | **5** each.
2–5 players; **no solo** — `start` refuses a table of one (409 "Liar's Dice needs at least two players.").

**Difficulty** = the wild rule and the clock:
easy — ones are NOT wild (a 1 is a 1, and may be bid), 45 s a turn;
medium — ones are wild (count as any face; nobody bids on ones), 45 s;
hard — ones wild, 30 s. The sentence is on the wire as `rule`.

**A round.** The server rolls every cup still in play. The first round is opened by the **host**;
every later round by the previous call's loser (or, if that took their last die, the next player
in). Turns pass in seat order (the room's `players` order), skipping anyone out.
On your turn: `{action:'bid', quantity, face}` — strictly higher than the standing bid (more dice
of any face, or as many of a higher face), `quantity` ≤ dice in play, `face` 1–6 (2–6 when wild) —
or `{action:'liar'}` once somebody has bid. A bad bid is 400 with a sentence and costs nothing;
off-turn is 409 "It's not your turn."

**A call** lifts every cup for `REVEAL_MS` (6 s): count the dice showing the bid's face (plus ones,
when wild). Count ≥ quantity → the caller loses a die; otherwise the bidder does. No dice left =
out. The last player with dice wins (`winnerIds:[them]`); standings are the winner, then the order
of going out, last out second.

**The turn clock.** When it runs out the server moves for you, marked `auto:true`: opening — one of
your own most common face (never ones; ties → higher face); otherwise one more of the standing face,
or a call when that would be more dice than the table holds. Every deadline after a step is set
from `now`, so one `advance` takes ONE step — a stale timestamp cannot auto-play a whole game — and
a non-finite `now` does nothing.

**Leaving** mid-game takes your dice out of play and counts as going out. Your turn passes to the
next player with a fresh clock; one player left wins. Bids already made stand — a leaver's bid can
still be called, and if it was a lie nobody loses a die. "Play again" is Boggle's.

Wire (GameRoom additions; lobby verbs, invites, stream as every other game):
```jsonc
{ "game":"liars-dice", "phase":"lobby|countdown|bidding|reveal|finished|closed",
  "dicePerPlayer":5, "wildOnes":true, "rule":"Ones are wild: …", "minFace":2, "turnMs":45000,
  "round":3, "starterId":"p_…", "turnId": null | "p_…",       // turnId only while bidding
  "totalDice":12, "startedAt":…, "phaseEndsAt":…,              // the turn clock while bidding, reveal end while revealing
  "bid":  null | {"playerId","quantity":4,"face":3,"auto":false},   // the standing bid
  "bids": [{"playerId","quantity","face","auto"}],             // this round's table talk, oldest first
  "players":[{"id","name","status","isHost","seated":true,"diceCount":4,"out":false,
              "dice": null | [1,3,3,5]}],   // MINE always; everyone's once finished; null otherwise
  "reveal": null | {"bid":{…},"challengerId","auto":false,"count":5,"loserId","eliminated":false,
                    "dice":[{"playerId","dice":[…]}]},        // from a call until the next roll (and at the finish)
  "standings": null | [{"id","name","place":1,"dice":2,"outRound":null,"left":false}],
  "winnerIds": [], "serverNow":… }
```
The invite's `about` reads "5 dice each · ones wild" (or "· no wilds").

## Game 10 — Draw & Guess (added 2026-09-29)

`game:'draw-guess'`. Pictionary: everybody draws in turn while the others guess. 2–5 players;
`start` with fewer than two joined is 409 "Draw & Guess needs at least two players."

**The host picks** on create (defaults in bold): `turnsEach` **1** | 2 (times round the table,
seat order) and `seconds` 60 | **80** | 100 per drawing. `difficulty` picks the word pool
(`words/draw-guess.ts`, 318 hand-picked words): easy = simple concrete nouns; medium adds
fussier things and a few actions; hard = medium + actions, places and ideas. No word is dealt
twice in a game.

**A turn:** `picking` (10 s: the drawer alone sees three words; `{action:'pick', index}`, else
the first is taken) → `drawing` (the clock) → `reveal` (5 s: the word, who got it, the drawing
stays up) → the next drawer, or `finished`. Letters are given away at 50% and 75% of the clock
(none for words of three letters or fewer); each is its own push.

**Moves** (drawer only, while drawing): `stroke {id, color, width, points:[[x,y],…]}` — the
canvas is 0…1000 square, points are rounded and clamped; an id the drawing already has
APPENDS to that stroke (its colour and width kept), so a line streams in pieces. Palette
black red orange yellow green blue purple brown, and `white` (the eraser); widths 6 | 14 | 32.
At most 300 points a post (400) and 5000 in a drawing (409 "The drawing is full…" — undo or
clear frees room). `undo` takes off the last stroke; `clear` wipes it.

`guess {text}` (anyone else, while drawing): normalised (case, accents, punctuation, spacing, a
leading a/an/the, a trailing plural s). Right → scored and marked solved; the feed says
"Sam got it!" and never shows the text. Wrong → the feed, for everyone. One letter off → a
`close` entry only the guesser sees (the near-miss would give the word away). One guess per
700 ms (409), solvers and the drawer 409.

**Scoring:** guessers 5 / 4 / 3 by order solved, then 2; the drawer 2 per solver, settled when
the drawing ends. It ends early when every guesser has it. A drawer leaving ends their turn
(reveal, no drawer points); fewer than two left → `finished`. Standings by score, ties share.

**Why the drawing is sent as changes.** Every change to a room pushes each phone its whole
`toWire` over SSE. Measured (`draw-guess.test.ts`): a drawing at its 5000-point cap is ~51 KB a
push; the drawer's 200 ms batches plus four guessers at their rate limit are ~10.7 pushes a
second, so ~540 KB/s per phone and ~2.7 MB/s out of the server for a family of five — for a
drawing that changed by a dozen points. So the drawing carries a `revision`, and a phone that
says what it holds gets only the changes after it (~1.1 KB a push, ~12 KB/s). The contract
barely moves: `toWire` takes an optional `since`; a game may export `revision(room)`; the SSE
stream keeps the cursor per subscriber (frames on one stream arrive in order, so the first is
whole and the rest are changes), and a POST may carry `since`. GET is always whole. A cursor
from before this drawing, past the 400-change log, or ahead of the room gets the whole drawing.

Wire (GameRoom additions; lobby verbs, invites, stream as every other game):
```jsonc
{ "game":"draw-guess", "phase":"lobby|countdown|picking|drawing|reveal|finished|closed",
  "turnsEach":1, "timeLimitMs":80000, "pickMs":10000, "revealMs":5000, "phaseEndsAt":…,
  "turn": null | {                                   // null in the lobby and countdown
    "index":0, "of":6, "drawerId":"…", "startedAt": null | …,   // startedAt: the drawing's start
    "choices": null | ["apple","kite","owl"],        // the drawer, while picking
    "word": null | "apple",                          // drawer + solvers while drawing; everyone at reveal
    "hint": null | "a___e",                          // while drawing: letters `_` until given away
    "solvers":[{"id","points"}], "drawerPoints": null | 4,     // drawerPoints once it ends
    "ended": null | "time|solved|left",
    "feed":[{"n":7,"playerId","name","kind":"guess|solved|close","text": null | "pear"}] },
  "drawing": null | { "revision":42,
    "since": null | 40,                              // null: `strokes` is the whole drawing
    "strokes": null | [{"id":1,"color":"red","width":6,"points":[[10,20],…]}],
    "ops": null | [{"seq":41,"op":"stroke","id":1,"color":"red","width":6,"points":[[…]]},
                   {"seq":42,"op":"undo"} | {"seq":…,"op":"clear"}] },
  "palette":["black",…,"white"], "widths":[6,14,32],
  "players":[{"id","name","status","isHost","score":9,"solved":true,"isDrawing":false}],
  "standings": null | [{"id","name","score"}], "winnerIds": [], "serverNow":… }
```
A phone applies `ops` with `seq` above its own revision when `since` ≤ its revision; if
`since` is above it, it missed something and fetches `GET /api/native/games/[id]` (whole).
The invite's `about` reads "80 seconds a drawing" (+ " · twice round").
