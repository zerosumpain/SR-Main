# Family games: Pass the Plate

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/pass-the-plate.ts`, catalogue entry `pass-the-plate`), SR-AppleApp (`Games/PassThePlate*.swift`). The leaderboard needs nothing: each finished standing carries its final `score`, which the generic recorder reads.

## The game

A card-drafting picnic for 2–5 players (five is the best table). Three rounds. At the start of each round a freshly shuffled deck deals everyone a plate of cards:

| Players | Cards each |
|---|---|
| 2 | 10 |
| 3 | 9 |
| 4 | 8 |
| 5 | 7 |

Every turn, everybody secretly takes one card off the plate in front of them. When the last person chooses (or the turn clock runs out), all the choices go down on the table together and every plate is passed on: to the next seat ("left") in rounds 1 and 3, to the previous seat ("right") in round 2. A choice can be changed until the reveal. When the plates are empty the round is scored, the tables are cleared (ice cream is kept), and the next round is dealt.

The deck, its names and its numbers are this game's own.

## The deck (112 cards; easy leaves out the gravy jug and the serving spoon: 102)

| Card | Kind id | Copies | Family | Scores |
|---|---|---|---|---|
| Pancake Stack 🥞 | `pancake` | 14 | pairs | 6 for every complete pair; an odd one 0 |
| Pizza Slice 🍕 | `pizza` | 14 | triples | 12 for every complete set of three; 1–2 left over 0 |
| Popcorn 🍿 | `popcorn` | 14 | sliding set | by how many: 1, 3, 6, 10, 14, then 18 for six or more |
| One / Two / Three Strawberries 🍓 | `berry1` `berry2` `berry3` | 6 / 12 / 8 | majority | count the berries on your cards at round end: most 7, second most 3 |
| Mini Pie / Pie / Family Pie 🥧 | `pie2` `pie3` `pie4` | 6 / 10 / 6 | pies | 2 / 3 / 4 |
| Gravy Jug 🫗 | `gravy` | 6 | multiplier | 0 itself; the NEXT pie you take after it scores double. Several jugs wait in order (oldest first), one pie each. A jug with no pie after it scores 0 |
| Serving Spoon 🥄 | `spoon` | 4 | take two | 0; on any later turn of the same round you may take two cards at once; the spoon then goes back onto the plate you pass on |
| Ice Cream 🍨 | `icecream` | 12 | dessert | kept across rounds and scored only at the end: most scoops +5; fewest −5 (only with three or more players) |

Ties, exactly as coded (`berryPoints`, `dessertPoints`):

- **Strawberries.** Only someone with at least one berry can score. Players tied for most split 7 (rounded down: two share 3 each, three share 2 each) and nobody scores second. Otherwise the most scores 7 and those tied for second split 3 (rounded down).
- **Ice cream.** If everyone has the same number of scoops nobody scores. Players tied for most split 5 (rounded down); with 3+ players those tied for fewest split −5 the same way (rounded towards zero). Zero scoops counts as fewest.
- **Final ranking.** Total = the three round totals + ice cream. Higher total wins; more ice cream breaks a tie; a tie on both is a shared win (`winnerIds` has both). Anyone who left is ranked below everyone still playing.

Round total = pancakes + pizza + popcorn + pies + strawberries. `scoreRound` returns the breakdown for each player; the tests check the breakdown adds to the total for every round of a whole clock-only game.

## Difficulty

| Level | Deck | Hints (`hints` on the wire) | Turn clock |
|---|---|---|---|
| easy | no gravy jug, no serving spoon (10 kinds) | `gains`: every card on my plate carries `gain` — what it adds to my pairs/triples/popcorn/pies right now — and every table shows `roundSoFar` | 40 s |
| medium | full deck | `total`: `roundSoFar` only | 30 s |
| hard | full deck | `none` | 20 s |

The reference card (each kind's name, emoji and one-line rule, `kinds`) is sent at every level: a child needs to know what a card does. `roundSoFar` and `gain` never include strawberries or ice cream, which depend on the other tables.

## Lobby

The shared verbs. `start` needs two joined (409 "Pass the Plate needs at least two players."); more than four invitees is 400. No create options beyond difficulty.

## Moves (`POST /api/native/games/<id>`)

| Body | Does |
|---|---|
| `{ action: "pick", cards: [uid] }` | Choose this turn's card. Replaces an earlier choice this turn. The last player to choose reveals the turn. |
| `{ action: "pick", cards: [uid, uid] }` | Take two: needs a Serving Spoon on your table and two cards on your plate. The two go down in that order (it matters for a gravy jug). |

400 with a sentence for: not one or two integers ("Choose one card from your plate."), the same card twice, a card not on your plate ("That card is not on your plate any more." — e.g. the plate moved on), two without a spoon. 409 outside `picking`. 403 for someone not seated.

## Timeouts and leaving

- Turn clock (`turnMs`, by difficulty): anyone who has not chosen gets a random card off their plate; that play is `auto: true` in `lastTurn`. A table of absent phones plays itself to the end.
- `scoring` lasts 8 s (`scoringMs`), then the next deal, or the finish after round 3.
- `advance` ignores a non-finite `now` and takes one step per call (each deadline is set from `now`), as Liar's Dice.
- Leaving mid-game: the leaver's plate is discarded (the remaining plates are all one size, so passing goes on round the smaller table), their finished rounds stay in the standings below everyone still playing, and if everyone else had chosen the turn is revealed at once. A table left with one player finishes with them the winner. The host role moves on; the host leaving the lobby closes it.

## Wire (`toWire`)

Hidden: other players' plates and everybody's pending choice except mine. The tests serialise every player's wire and search it for every other player's card uids.

Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `startedAt`, `phaseEndsAt`, `standings`, `winnerIds`, `serverNow`):

- `rounds` (3), `round` (1-based), `turn` (1-based within the round), `handSize`, `direction` (`left` | `right`), `passTo` / `passFrom` (my neighbours' ids this round), `turnMs`, `scoringMs`, `hints`.
- `kinds`: `[{ kind, name, emoji, family, count, value, rule }]` — this difficulty's deck.
- `hand`: MY plate, `[{ uid, kind, gain }]` (`gain` a number on easy, else null). `myPick`: my pending uids. `canTakeTwo`.
- `players[]`: `seated`, `handCount`, `picked` (chosen this turn, never what), `played: [{ uid, kind, boosted, spent }]` (this round's table, in order), `iceCream` (scoops so far), `berries` (this round), `score` (finished rounds, plus ice cream once finished), `roundSoFar` (null on hard), `left`.
- `lastTurn`: `[{ playerId, cards: [{uid, kind}], auto }]` — the last reveal.
- `results`: `[{ round, rows: [{ playerId, pancakes, pizza, popcorn, pies, berryCount, berries, scoops, total }] }]`.
- `dessert`: `[{ playerId, scoops, points }]` once finished.
- `phase`: `lobby` | `countdown` | `picking` | `scoring` | `finished` | `closed`.

Standings: `[{ id, name, place, score, scoops, left }]`, best first.

## Not built

- No web page: it plays in the app.
- No card art: the emoji above, on the app's own card faces.
- No "your turn" push; no chat; no spectators.
- The deck is reshuffled whole every round (a physical game keeps one deck going); that keeps every round's deal independent of how many people left.
