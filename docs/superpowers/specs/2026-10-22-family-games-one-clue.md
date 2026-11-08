# Family games: One Clue

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/one-clue.ts`, `words/one-clue.ts`, catalogue entry `one-clue`), SR-AppleApp (`Games/OneClue*.swift`). The leaderboard needs nothing new: the finished `standings` give every player the team's score.

## The game

A co-operative word game for 3–7 players. Ten cards a game. On each card one player is the **guesser**; the guesser goes round the table in seat order (the first is picked at random). Everyone else is a **clue-giver**: they are shown the secret word and each writes **one** one-word clue, without seeing anybody else's.

1. **Clues.** Each clue-giver writes (and may rewrite) one clue, then **locks it in**. The app saves the draft as they type, so a draft counts if the clock runs out, but only a lock ends the phase early: it ends when every clue-giver still in has locked a clue in, or on the clue clock. Editing a locked clue unlocks it. (A pause mid-word must never send a half-written clue to the table.)
2. **The checks** (automatic, at the end of the clue phase). A clue is cancelled when it is:
   - `empty` — not written (the clock ran out);
   - `not-one-word` — more than one word after normalising ("ice-cream" is two), or no letters at all;
   - `too-close` — the word itself, the same stem ("baking" for *bake*), part of the word ("sun" for *sunset*) or containing it ("snowman" for *snow*);
   - `duplicate` — the same as another clue once normalised, or sharing a root; **every** copy goes.
   Normalising: lower case, accents off, apostrophes dropped, other punctuation a space, a leading "a/an/the" dropped. The roots are light: the word, its singular (`-s/-es/-ies`), and only when an `-ing` or `-ed` really came off, that root as written, with an `e` back on and with a doubled consonant undone (bake/bakes/baked/baking share *bake*; run/running share *run*). A plain word keeps its last letter, so *kite* is never *kit* and *hope* and *hop* are two clues. An ending only comes off a root with a vowel left (*string* stays) and never off `-eed` (*speed* stays).
3. **Review.** The clue-givers see every clue as judged and may veto one that is too close in a way the checks cannot see (a sound-alike, a translation, a misspelling of the word). Skipped when there is one clue-giver (nobody to veto) or nothing survived the checks. Ends when every clue-giver still in says done, or on the review clock.
4. **Guess.** The guesser sees only the clues that survived (and how many were cancelled — never their text) and guesses or passes.
5. **Reveal.** Everyone sees the word, every clue with its status, the guess and the outcome. Next card when everyone still in says ready, or on the reveal clock.

**Veto rule: a majority of the other clue-givers** — a clue is struck once half the *other* clue-givers still in (rounded up) have vetoed it. With two clue-givers the other one's veto is enough; with three, one of two; with six, three of five. Chosen over "any one veto" because the table has children on it: a single mischievous (or over-cautious) veto cannot wipe out a good clue at a bigger table, while at the smallest table one sensible objection still works. It is also the rule Categories already uses, so the family learns one rule.

**Scoring.** Right: +1. Pass (or the guess clock running out): the card is lost. Wrong: the card is lost **and the next card is discarded unplayed** (shown face up in the card list as `discarded`). A wrong guess on the tenth card, where there is no next card, takes back one card already won instead (`tookBack`; never below 0). The team's score out of ten is everyone's result.

**Guess matching** forgives case, accents, a leading article, spaces ("tooth brush"), a shared root ("elephants", "cheeses") and a trivial typo in a long word: none under six letters, one edit (insert, delete, change, swap) for six to nine letters, two from ten. A typo counts only when the guess keeps the word's first letter and is not a real word: not another word on the lists (*horse* is not *house*), and not one of `NOT_TYPOS` — real words a typo away from a listed word (*plant* is not *planet*, *winner* is not *winter*), generated once from a system word list and checked by hand (US spellings such as *flavor* and common misspellings such as *lightening* left off, so they still count). Another listed word is never the answer even when it shares a root (*paint* is not *painting*); a test checks no listed word is accepted for any other, and that every `NOT_TYPOS` entry still sits a typo from a listed word. The cost of a wrong "correct" is a two-card swing on a ten-point score, so the matcher errs strict: a short word must be spelled right.

## Difficulty

The word list and the clue clock:

| Level | Words | Clue clock |
|---|---|---|
| easy | concrete everyday nouns: animals, food, toys, home and school | 90 s |
| medium | a wider world: places, jobs, weather, sports, a few activities | 75 s |
| hard | ideas and less common things (echo, gravity, patience) — the obvious clue is the one everybody writes, so more duplicates cancel | 60 s |

Review 30 s, guess 60 s, reveal 12 s at every level. Every list is curated by hand (`words/one-clue.ts`), static, family-safe for under-13s, single lower-case words, no brands, people or place names; a test checks the shape and that no word repeats across lists. Each game deals ten different words; "Play again" keeps the last game's ten off the next deal.

## Lobby

Up to **seven** players — more than the site's usual five. `GameRules` gained an optional `maxPlayers` (read by the API's create check and the lobby's invite check; every other game keeps `MAX_PLAYERS` = 5) and `minPlayers` (used by the catalogue-wide results test; the rules module's own `start` enforces it). `start` needs three joined (409 "One Clue needs at least 3 players."). Creating a room with fewer invitees is allowed — the host can invite more from the lobby — so the app's New Game sheet says three are needed rather than calling it solo.

## Moves (`POST /api/native/games/<id>`)

| Body | Who / when | Does |
|---|---|---|
| `{ action: "clue", text, lock? }` | clue-giver, `clues` | Writes over their clue; empty clears it. Trimmed, cut to 30 characters. Without `lock` it is a draft and undoes an earlier lock; `lock: true` locks it in (400 with nothing written; 400 for a `lock` that is not a boolean). Never refused for its content — the checks cancel it, so the table sees why. 409 after the clock + 1 s grace; 403 for the guesser. |
| `{ action: "veto", playerId }` / `"unveto"` | clue-giver, `review` | On another clue-giver's clue that passed the checks (400 "That clue is already out." otherwise). Idempotent. |
| `{ action: "done" }` | clue-giver in `review`; anyone still in during `reveal` | Seen enough / ready for the next card. |
| `{ action: "guess", text }` | guesser, `guess` | 400 for an empty guess. Right or wrong settles the card. |
| `{ action: "pass" }` | guesser, `guess` | The card is lost. |

## Phases and timeouts

`lobby` → `countdown` → (`clues` → `review`? → `guess` → `reveal`) × 10 → `finished` → `closed`.

Nobody's silence freezes the room: an unwritten clue is `empty` when the clue clock ends, the review closes on its clock, a guesser who never answers **passes** (outcome `timeout`), and the reveal moves on. `advance` loops, so a room nobody touches plays out to `finished` in one catch-up, and returns `false` for a non-finite clock (NaN guard).

**Leaving.** In the lobby the host leaving cancels it. In the countdown, leaving so that fewer than three remain sends the room back to the lobby (a lone player left closes it) — a short game is never dealt. In play: fewer than two left ends the game with the score so far; the guesser leaving a card in play loses that card (`left`, no penalty) and the next guesser carries on; a clue-giver leaving stops the table waiting on them — a clue already written still counts, their vetoes stop counting and the strike bar drops. The host role passes on.

## Wire (`toWire`) — per viewer

Shared: `id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `startedAt`, `phaseEndsAt`, `serverNow`, `standings`, `winnerIds` (always `[]` — co-op), plus `cardCount` (10), `minPlayers`, `maxPlayers`, `clueMs`, `reviewMs`, `guessMs`, `revealMs`, `maxClue`, `maxGuess`, `score`, `cardIndex` (0-based, null outside play), `guesserId`, `role` (`guesser` | `clue` | `watching` | null).

Hidden information:

- **The deck** (the game's ten words) never leaves the server.
- `word`: the clue-givers still in, during `clues` / `review` / `guess`; everyone from `reveal`. Never the guesser, a leaver or a watcher before the reveal.
- `myClue`, `myLocked`: my own clue (draft or locked) while writing, clue-givers only. Nobody sees another clue while writing; `players[].submitted` says only who has **locked** one in — a draft is nobody else's business.
- `clues: [{ playerId, text, status, vetoes, strikeAt, vetoed }] | null`: in `review`, every clue judged — to clue-givers only (the guesser gets null). In `guess`, the clue-givers get all of them; the guesser gets only `status: "ok"` ones plus `cancelledCount`. From `reveal`, everyone gets all of them. `vetoed` is whether *I* vetoed it.
- `guess`, `outcome`, `tookBack`: the card just settled, in `reveal`.
- `cards: [{ index, word, guesserId, outcome, guess, tookBack, clues: [{ playerId, text, status }] }]`: every settled card (discarded ones too) — public, since they are over.
- Each player: `id`, `name`, `status`, `isHost`, `role`, `submitted`, `done`.

Tests build the wire for **each** player at each phase, serialise it to JSON and search it for the word, the other clues and the rest of the deck (`one-clue.test.ts`, "the wire never leaks").

Standings (finished): everyone still in, `{ id, name, score, guessed, clues }` — `score` is the **team** score for all; `guessed` the cards they guessed right, `clues` their clues that reached a guesser. `verdict` is a sentence for the score. The recorder ranks everyone 1 with the team score; nobody "wins".

## Not built

- A web table: One Clue is played in the app only.
- Spoken or typed clue moderation beyond the checks and the vetoes: there is no free-text safety filter on clues or guesses; they are seen only by the family at the table, and the review is where a silly clue gets struck.
- Proper stemming or a full dictionary: the roots are deliberately light, the only dictionary is the generated `NOT_TYPOS` list of near-words, and a clue that is a misspelling of the word is left to the vetoes. A real word not in the system list (or added to the word lists later without regenerating) could still pass as a typo of a six-plus letter word.
- Choosing the number of cards or the clocks; a "your turn to guess" push.
