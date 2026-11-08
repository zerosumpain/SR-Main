# Family games: Fireworks

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/fireworks.ts`, catalogue entry `fireworks`), SR-AppleApp (`Games/Fireworks*.swift`). The leaderboard needs nothing new: every standing carries the team's `score`, so the generic recorder files the same score for each player.

## The game

Co-operative, 2 to 5 players. The team builds one firework per colour, each from 1 up to 5 in order. You hold your cards facing away from you: every phone shows everyone else's cards and, of its own, only what hints have said.

- Deck: each colour has three 1s, two each of 2, 3 and 4, and one 5 (10 cards). Five colours (red, yellow, green, blue, white) = 50 cards; hard adds a sixth, **prism** = 60.
- Hands: 5 cards at 2–3 players, 4 at 4–5. Dealt one at a time in seat order; the host goes first.
- 8 hint tokens at the start.
- On your turn, one of:
  - **Hint** one other player: one colour OR one number. It points at EVERY matching card in their hand, must point at one at least, and costs a token (none left = no hints).
  - **Drop** a card: face up on the discards, a token back (max 8; refused while all 8 are in).
  - **Play** a card: if it is the next number for its colour it joins that firework (finishing a 5 wins a token back, if one is out); otherwise it is a **misfire** — one misfire marker, and the card is discarded.
  - After a play or a drop you draw, while the deck lasts.
- The show ends when:
  - the misfires reach the difficulty's limit — **the team keeps the fireworks built so far** (chosen over "score 0" for a family table: a bad last play should not wipe out a good game);
  - every firework is complete (a **perfect** show);
  - one full lap after the last card is drawn: everybody, the player who drew it included, has exactly one more turn;
  - fewer than two players are left at the table (one player cannot be hinted).
- Score = the sum of the firework tops (max 25, or 30 on hard).

## Difficulty

| Level | Colours | Misfires that end the show | Turn clock | Help |
|---|---|---|---|---|
| easy | 5 | 4 | 90 s | Each of your cards also says what it **could** still be, counting the copies you can see (fireworks, discards, other hands — never your own hand). |
| medium | 5 | 3 | 75 s | Hints only. |
| hard | 6 (prism) | 3 | 60 s | Prism cards are pointed at by EVERY colour hint and no hint names prism; a card two different colour hints pointed at must be prism. |

## Moves (`POST /api/native/games/<id>`)

| Body | Does |
|---|---|
| `{ action: "hint", to: "<playerId>", colour: "red" }` or `{ action: "hint", to, rank: 3 }` | On your turn. 400 with a sentence for no or both of colour/rank, a colour outside the five (prism cannot be named), a rank outside 1–5 or not an integer (NaN included), a hint to yourself or someone not at the table, or a hint that points at nothing. 409 for no tokens, off-turn. |
| `{ action: "play", card: <id> }` | On your turn. 400 if the id is not in your hand. |
| `{ action: "discard", card: <id> }` | On your turn. 409 while every token is in. |

Card ids are the card's place in this game's shuffled deck, numbered AFTER the shuffle, so an id is no clue to what the card is.

## Timeouts

A player whose turn clock runs out has their oldest card that no hint has touched dropped for them (their oldest card when every card has been hinted), logged with `auto: true`. With every token in, the timed-out drop still happens but wins no token. `advance` guards a non-finite `now` and takes one step per call (every deadline is set from `now`), so a far-future clock cannot auto-play a game.

## Leaving

Lobby: as Liar's Dice (the host leaving cancels; host role passes on later; the last one out closes the room). In play: the leaver's cards go face up onto the discards (no misfire, no token), their turn passes on, and they lose their last turn if the final lap is running. A table left with one player ends the show (`ending: "left"`) with the score so far. Leavers stay in the standings with `left: true`.

## Wire (`toWire(room, meId, now)`)

Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `startedAt`, `phaseEndsAt`, `standings`, `winnerIds`, `serverNow`):

- `rule` (the difficulty in a sentence), `colours` (the suits in play, prism last on hard), `hintColours` (the five a hint may name), `turnMs`.
- `turnId`, `turn` (turns taken), `hints`, `maxHints`, `misfires`, `maxMisfires`, `deck` (a COUNT, never the cards), `finalTurns` (turns left in the final lap, or null while the deck lasts), `stacks { colour: top }`, `score`, `maxScore`, `ending` (`perfect` | `misfires` | `deck` | `left` | null).
- `discards: [{ id, colour, rank }]`, in the order dropped.
- `log`: every action, oldest first, one shape: `{ kind: hint|play|discard, by, to, colour, rank, cards, ok, auto, card }` (hint: `to`, `colour` or `rank`, `cards` = ids pointed at; play/discard: `card` face up, `ok` for a play, `auto`).
- `players[]`: `id`, `name`, `status`, `isHost`, `seated`, `hand[]` oldest first: `{ id, colour, rank, knows: { colours, ranks, hinted }, could }`.
  - **Your own hand**: `colour` and `rank` are `null` until the game is finished. `knows` is derived from the hints alone — the colours and numbers the card can still be (positive and negative knowledge both). `could` (easy only, else null) narrows `knows` by the copies you can see.
  - Everyone else's hand: face up, with their `knows` (what they have been told), `could` null.
- Hidden: your own cards' identities, the deck. Tests build the wire for each player, serialise it and search for the viewer's own colour and the deck's cards.

Standings (finished only): every seated player in seat order, `{ id, name, place: 1, score, maxScore, left }` — the whole team shares the score. `winnerIds` is the whole team on a perfect show, else empty, so the leaderboard counts a perfect show as a win for everyone and otherwise files the shared score (all rank 1).

`about`: "5 colours · 3 misfires".

## Not built

- No in-game chat or table talk: the hints are the only channel, as intended.
- No "your turn" push (as Chess: a push per turn would ring a phone already looking at the table).
- No web table: Fireworks is played in the iPhone app only.
- No variants beyond prism (no "critical card" warnings, no hint-token variants).
