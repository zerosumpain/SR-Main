# Family games: Homestead

Status: designed 2026-10-22, not built. Game id `homestead`. Branches: SR-Main `feat/games-homestead-20261022` (`~/sr-main-games-homestead`), SR-AppleApp `feat/games-homestead-20261022` (`~/sr-appleapp-games-homestead`). Depends on durable rooms (`2026-10-22-family-games-durable-rooms.md`, built in parallel on `feat/games-durable-20261022`).

Homestead is an island-settling hex board game for 3 to 5 players (the family is five), in the tradition of the classic trading-and-building board games, with its own names, board shapes and rule text. Nothing here (names, card titles, artwork, rule wording) is taken from any published game. Children under 13 play: the language is plain, nothing is violent, and the "thief" is a fox that sits on a field and pinches a card.

Files: SR-Main `src/lib/games/homestead-board.ts` (pure geometry and board generation), `homestead.ts` (the room: rules over a room, same shape as `liars-dice.ts`/`chess.ts`; its public face, split for the 1,000-line new-file gate into `homestead-model.ts` types and read-only queries, `homestead-trade.ts` bank and offers, `homestead-wire.ts` the per-viewer wire), `homestead.test.ts` + `homestead.play.test.ts`, `homestead-board.test.ts`; catalogue entry `homestead`. SR-AppleApp `Games/HomesteadLogic.swift` (geometry, decoding, legal-target mapping), `HomesteadStore.swift`, `HomesteadScreen.swift`, `HomesteadBoardView.swift`, tests `HomesteadTests.swift`.

## Names

| Thing | Homestead name |
|---|---|
| Resources | `timber`, `clay`, `wool`, `grain`, `stone` (always in this order) |
| Tiles | woods (timber), clay pit (clay), meadow (wool), fields (grain), quarry (stone), `dunes` (nothing) |
| Thief | the **fox** |
| Pieces | `road`, `cottage` (1 VP), `town` (2 VP, upgrades a cottage) |
| Development deck | **almanac** cards |
| Knight | `ranger`: move the fox and take a card |
| Victory point card | `heirloom`: +1 VP, hidden until the end |
| Road building | `pathfinders`: two free roads |
| Year of plenty | `harvest`: take any two resources from the bank |
| Monopoly | `market`: name a resource; every other player hands you all of it |
| Longest road | **Longest Trail** (2 VP) |
| Largest army | **Chief Ranger** (2 VP) |
| Harbour | `harbour`: 3:1 (`any`) or 2:1 for one resource |

## Coordinates (the one scheme server and app share)

**Hexes**: axial `(q, r)`, pointy-top, `r` grows downward. Neighbours: E `(+1,0)`, W `(-1,0)`, NE `(+1,-1)`, NW `(0,-1)`, SE `(0,+1)`, SW `(-1,+1)`. Id: `"q,r"`, e.g. `"0,0"`, `"-2,1"`.

**Vertices**: every corner of a pointy-top grid is the top (`N`) corner of exactly one hex or the bottom (`S`) corner of exactly one hex. Id: `"q,r,N"` or `"q,r,S"`. The six corners of hex `(q,r)`, clockwise from the top:

| Corner | Id |
|---|---|
| top | `q,r,N` |
| upper right | `q+1,r-1,S` |
| lower right | `q,r+1,N` |
| bottom | `q,r,S` |
| lower left | `q-1,r+1,N` |
| upper left | `q,r-1,S` |

Vertex neighbours: `q,r,N` ↔ `q,r-1,S`, `q+1,r-1,S`, `q+1,r-2,S`; `q,r,S` ↔ `q,r+1,N`, `q-1,r+1,N`, `q-1,r+2,N`.

**Edges**: every side is the `NE`, `NW` or `W` side of exactly one hex. Id: `"q,r,NE"`, `"q,r,NW"`, `"q,r,W"`. The six sides of hex `(q,r)`, clockwise from upper right: `q,r,NE`, `q+1,r,W` (E), `q,r+1,NW` (SE), `q-1,r+1,NE` (SW), `q,r,W`, `q,r,NW`. Endpoints:

| Edge | Ends |
|---|---|
| `q,r,NE` | `q,r,N` and `q+1,r-1,S` |
| `q,r,NW` | `q,r-1,S` and `q,r,N` |
| `q,r,W` | `q-1,r+1,N` and `q,r-1,S` |

A vertex or edge of the board is any corner/side of a land hex; its id may name a hex that is NOT on the board (a coastal corner owned by a sea hex). Never validate a vertex or edge by "its hex exists": validate against the board's vertex/edge set.

Formatting is canonical: integers in base 10, no `+`, no spaces, `-0` never occurs (`${q},${r},${d}`). Server parsing: hex `^-?\d+,-?\d+$`, vertex `^-?\d+,-?\d+,(N|S)$`, edge `^-?\d+,-?\d+,(NE|NW|W)$`, then membership in the board's set; anything else is 400 "That's not a spot on the board."

**Pixels** (app only; size `s` = hex circumradius, y down): centre of `(q,r)` = `(s·√3·(q + r/2), s·1.5·r)`. Vertex `N` = centre + `(0, −s)`, `S` = centre + `(0, +s)`. An edge's midpoint is the mean of its two ends. Pure functions in `HomesteadLogic.swift`, each with an XCTest (corner ids of a hex, neighbour sets, every edge's two ends are both corners of the hexes it touches, 54/72 and 84/114 counts below).

## The island

Two sizes, `options.island`: `standard`, `large`, or `auto` (default: `large` with 5 players at start, `standard` otherwise).

| | standard | large |
|---|---|---|
| Shape | every hex with axial distance ≤ 2 from `0,0` | distance ≤ 3, minus the six corner hexes (`±3` pairs with a `0`) |
| Hexes | 19 | 31 |
| Vertices / edges | 54 / 72 | 84 / 114 |
| Tiles | 4 woods, 3 clay pit, 4 meadow, 4 fields, 3 quarry, 1 dunes | 6 woods, 5 clay pit, 6 meadow, 6 fields, 5 quarry, 3 dunes |
| Number tokens | 2, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12 (18) | 2×2, 3×3, 4×3, 5×3, 6×3, 8×3, 9×3, 10×3, 11×3, 12×2 (28) |
| Harbours | 9: 4 `any` (3:1), one 2:1 per resource | 11: 6 `any`, one 2:1 per resource |
| Coastal edges | 30 | 42 |
| Harbour positions (coast index) | 0, 3, 6, 10, 13, 16, 20, 23, 26 | 0, 3, 7, 11, 15, 19, 22, 26, 30, 34, 38 |
| Bank | 19 of each resource | 24 of each |
| Almanac deck | 14 ranger, 5 heirloom, 2 pathfinders, 2 harvest, 2 market (25) | 20 ranger, 5 heirloom, 3 pathfinders, 3 harvest, 3 market (34) |

Each player has 15 roads, 5 cottages, 4 towns on either size.

**Coast order**: coastal edges (sides of exactly one land hex) sorted by the clockwise angle of their midpoint from straight up (`atan2(x, −y)` mod 2π, pixel space); index 0 is the smallest angle. Harbour `i` of the table sits on coastal edge `floor(i · coast / count)`, which gives the positions above and never puts two harbours on one vertex (asserted in a test). Harbour kinds are shuffled over the positions. A harbour belongs to its edge's two vertices.

**Generation** (`generateIsland(size, rng)`): shuffle tiles over hexes; shuffle tokens over the non-dunes hexes; accept the layout when

1. no two hexes holding a 6 or an 8 are neighbours;
2. no two neighbouring hexes hold the same number;
3. no three mutually adjacent hexes are the same resource.

Up to 2000 tries; on failure use the fixed layout `FALLBACK[size]` (checked into `homestead-board.ts`, itself asserted to pass all three rules). The fox starts on a dunes hex (the first in id order). A test generates 500 islands of each size from seeded rngs and checks every rule, the tile and token counts and the harbour spacing.

Pips (the dots under a number: chance in 36): 2/12 = 1, 3/11 = 2, 4/10 = 3, 5/9 = 4, 6/8 = 5. Used by auto-moves and hints, and sent on the wire.

## Randomness

The room keeps its own seeded generator, `rng: [a, b, c, d]` (sfc32, four uint32), seeded from `crypto.randomBytes(16)` in `createRoom` unless a test passes `options.seed` (never forwarded from a request: `startGame` passes only its fixed option keys). Moves draw from it (dice, steals, almanac shuffle); the registry's `rng` argument to `advance` is not used. The state is JSON-safe and durable, and it is **never** on the wire.

## Phases and steps

`phase` (what the registry and the app's resume row read): `lobby` → `countdown` (3 s) → `playing` → `finished` → `closed`. Inside `playing`, `step`:

| Step | Who acts | Moves | On timeout |
|---|---|---|---|
| `setup` | the active player | `build` cottage, then `build` road touching it | best-pip legal vertex; then the legal road toward its best-pip neighbour vertex |
| `roll` | active | `roll`; `play` ranger | rolls |
| `discard` | everyone owed a discard (simultaneous) | `discard` | discards from whichever resource they hold most of, one at a time (ties in resource order) |
| `fox` | active | `fox` | the legal hex with the most opponent pips (town counts twice), not touching their own buildings if any such hex exists; victim = eligible player with most public VP, then most cards, then seat |
| `main` | active (and in 5-player games, others may `build`/`buy`: open building) | `build`, `buy`, `play`, `bank`, `offer`, `counter`, `accept`, `refuse`, `cancel`, `end` | `end` (open offers cancelled) |
| `roads` | active (placing pathfinders' free roads) | `build` road, `skip` | `skip`, then `end` |

**Setup** is a snake: seats `0…n−1` each place a cottage then a road touching it; then `n−1…0` again. A cottage placed in the second round produces one of each resource from its land hexes. Then seat 0's first `roll` step. Seat order is random (from the room rng) at start; "Play again" deals a new island and a new seat order.

**A turn**: `roll` (two dice). Not 7: every hex with that number and no fox pays each adjacent cottage 1 and town 2. If the bank cannot pay everyone owed a resource, nobody gets that resource that roll, unless only one player is owed it (they get what is left). 7: every player holding more than 7 resource cards owes `floor(count / 2)` → `discard` step (skipped if nobody owes) → `fox` step → `main`. A `ranger` played in `roll` goes to `fox` and back to `roll`; played in `main`, back to `main`. `end` passes to the next seat's `roll`.

**Timers** (`phaseEndsAt` is the running decision's deadline):

| | easy | medium | hard |
|---|---|---|---|
| live: setup placement | 90 s | 90 s | 60 s |
| live: roll | 30 s | 30 s | 20 s |
| live: main / roads | 180 s | 120 s | 90 s |
| live: discard / fox | 60 s | 60 s | 45 s |
| async: any decision | `deadlineHours` (12 / 24 / 48, default 24) |||

A timed-out decision is marked `auto` in the log. **Away**: a player whose turn was auto-ended twice in a row is `away: true`; an away player's decisions time out after 15 s (live) or 1 h (async) until they make any move themselves. If every joined player is away the room closes ("Everyone's away — game abandoned."), no result recorded. `resume` (durable rooms) restarts the running decision's live timer at full length after a restart.

**Leaving** mid-game: the leaver's pieces stay on the board, their cards go back to the bank, their offers are cancelled and their turns are skipped (an active leaver's turn ends). With fewer than 2 joined seated players left, the game finishes and the one still there wins (`reason: "left"`). Leaving in the lobby follows the chess rule (host leaving cancels).

## Building

Costs (`COSTS`, also on the wire):

| Piece | Cost |
|---|---|
| road | 1 timber, 1 clay |
| cottage | 1 timber, 1 clay, 1 wool, 1 grain |
| town | 2 grain, 3 stone |
| almanac card | 1 wool, 1 grain, 1 stone |

- **Cottage**: an empty board vertex whose neighbour vertices are all empty (the distance rule), touching one of your roads (except in setup), with a cottage piece left.
- **Town**: replaces one of your cottages (the cottage piece comes back to you), with a town piece left.
- **Road**: an empty board edge that touches one of your buildings, or touches one of your roads at a vertex that does not hold another player's building. In setup, only an edge touching the cottage just placed.

## Almanac cards

`buy` draws the top card of the shuffled deck (409 when empty). A card bought this turn cannot be played this turn. At most one almanac card is played per turn. Heirlooms are never played; they count towards your own total at once (so they can win you the game on your turn) and are revealed to everyone at the end. `ranger`: playable in `roll` or `main`; moves the fox. `pathfinders`: up to two free roads (`roads` step; if you have no legal road or no road pieces it does nothing more). `harvest`: `take` two resources (may be the same) from the bank; 409 if the bank lacks them. `market`: name a `resource`; every other player gives you all they hold of it (the amounts are public).

## The fox

`fox {hex, victim?}`: the fox must move to a different land hex. On easy it is a **friendly fox**: it may not go to a hex touching a building of another player with 2 public VP or fewer (if that leaves no hex, the dunes are allowed; if still none, any other hex). Eligible victims: players other than you, with at least one resource card, owning a building on that hex. With two or more eligible, `victim` is required; with one, it is taken; with none, nothing is taken. The card is chosen at random from the victim's hand. Only the thief and the victim see which resource it was.

## Trading

Only in the active player's `main` step, and every trade has the active player on one side.

- **Bank** `bank {give, get}`: give `rate` of one resource for one of another (`get ≠ give`). Rate = 2 with that resource's harbour, else 3 with any `any` harbour, else 4. 409 if the bank has none of `get`.
- **Offers**: `give` and `want` are resource-count maps, each non-empty, no resource on both sides, no gifts (a side of nothing is refused).
  - `offer {give, want, to?}` (active): `to` = list of player ids, or absent/null for everyone. At most 3 open offers by the active player.
  - `counter {offerId, give, want}` (a player the offer was to): a new offer from them to the active player only, `counterTo: offerId`. One open counter per player per offer.
  - `accept {offerId}`: by a recipient of the active player's offer, or by the active player on a counter. **Accepting executes the trade at once** (the proposer agreed by proposing); first accept wins; the offer is `done`. Both sides must still hold their cards, else 409 "Sam no longer has those cards." and the offer becomes `void`.
  - `refuse {offerId}`: a recipient says no (shown on the offer). (`decline` is a lobby verb, so the trade word is `refuse`.)
  - `cancel {offerId}`: the proposer withdraws it.
  - Every open offer is cancelled when the turn ends, the active player rolls a 7, or either side's hand no longer covers it after another trade (then `void`).
- Everyone sees every offer and its status.

## Open building (5-player games)

Instead of a special build phase between turns (which in an async game would add four waits per turn), in a game with 5 seated players any player may `build` or `buy` during another player's `main` step. They may not trade or play cards off-turn, and they cannot win off-turn: a player who reaches the target off-turn wins at the start of their own turn. Concurrent builds are serialised by the server; the second to claim a spot gets 409 "Someone just built there."

## Scoring and winning

Cottage 1, town 2, Longest Trail 2, Chief Ranger 2, heirloom 1 each. `publicVp` excludes heirlooms.

- **Longest Trail**: the longest run of your roads with no edge used twice, not passing through a vertex holding another player's building. 5 or more to claim; take it from the holder only by beating them. If the holder's trail is broken and two or more others tie for longest (≥ 5), nobody holds it; if the holder drops but still ties the longest, they keep it. Recomputed for everyone after every road or building.
- **Chief Ranger**: 3 or more rangers played; take it only by playing more than the holder.
- **Win**: the moment the active player's total (heirlooms included) reaches the target on their own turn, including at the start of their turn, the game finishes (`reason: "points"`).

## Difficulty

| | easy | medium | hard |
|---|---|---|---|
| Target | 8 VP | 10 VP | 10 VP |
| Fox | friendly (≤ 2 public VP protected) | standard | standard |
| Costs card in the app | shown | shown | hidden |
| `hints` on the wire | `affordable` + up to 3 `trades` + `tip` | `affordable` only | null |
| Live timers | longest | standard | shortest |

`legal` (where you may build now) is sent at every level: it is what makes the board tappable. On hard the app lights targets only after you pick a piece.

## Moves (`POST /api/native/games/<id>`, `{ action, …fields }`)

| Action | Body | Who / when | Refusals |
|---|---|---|---|
| `roll` | `{}` | active, `roll` | 409 off-turn / wrong step |
| `build` | `{ piece: "road" \| "cottage" \| "town", at: id }` | active in `setup`/`main`/`roads`; others in 5-player `main` | 400 bad id or not legal there ("You need a road next to it." etc.), 409 can't afford / no pieces / wrong step |
| `buy` | `{}` | as `build` minus setup | 409 can't afford / deck empty |
| `play` | `{ card: "ranger" }`, `{ card: "pathfinders" }`, `{ card: "harvest", take: [r, r] }`, `{ card: "market", resource: r }` | active, `roll` (ranger only) or `main` | 409 not held / bought this turn / already played one this turn |
| `fox` | `{ hex: id, victim?: playerId }` | active, `fox` | 400 same hex / not allowed (friendly fox) / victim not eligible; 400 victim missing when ≥ 2 eligible |
| `discard` | `{ cards: { timber?: n, … } }` | a player owed a discard, `discard` | 400 wrong total / cards not held |
| `bank` | `{ give: r, get: r }` | active, `main` | 409 can't cover the rate / bank empty |
| `offer` | `{ give: {…}, want: {…}, to?: [playerId] \| null }` | active, `main` | 400 empty side / overlap / gift; 409 cards not held / 3 open |
| `counter` | `{ offerId, give: {…}, want: {…} }` | a recipient | as `offer` |
| `accept` | `{ offerId }` | recipient (active's offer) or active (counter) | 409 gone / cards no longer held |
| `refuse` | `{ offerId }` | recipient | 409 gone |
| `cancel` | `{ offerId }` | proposer | 409 gone |
| `skip` | `{}` | active, `roads` | — |
| `end` | `{}` | active, `main` | 409 wrong step |

Lobby verbs as every game (`join`, `decline`, `leave`, `start`, `again`, `invite`). `start` needs 3 to 5 joined (409 "Homestead needs three players."; the shared `MAX_PLAYERS` is already 5). Create options: `pace` (`live` \| `async`), `deadlineHours` (12 \| 24 \| 48), `island` (`auto` \| `standard` \| `large`).

## Catalogue entry

```ts
homestead: {
  ...homestead,            // exports durable = { schema: 1 }, paces = ['live', 'async'], waitingOn, resume
  moves: {
    // Raw on purpose: each types its own fields (400 with a sentence for a bad spot or hand).
    roll: (room, p, _b, now) => homestead.roll(room as homestead.Room, p, now),
    build: (room, p, b, now) => homestead.build(room as homestead.Room, p, { piece: b.piece, at: b.at }, now),
    buy: (room, p, _b, now) => homestead.buy(room as homestead.Room, p, now),
    play: (room, p, b, now) => homestead.play(room as homestead.Room, p, { card: b.card, take: b.take, resource: b.resource }, now),
    fox: (room, p, b, now) => homestead.fox(room as homestead.Room, p, { hex: b.hex, victim: b.victim }, now),
    discard: (room, p, b, now) => homestead.discard(room as homestead.Room, p, { cards: b.cards }, now),
    bank: (room, p, b, now) => homestead.bank(room as homestead.Room, p, { give: b.give, get: b.get }, now),
    offer: (room, p, b, now) => homestead.offer(room as homestead.Room, p, { give: b.give, want: b.want, to: b.to }, now),
    counter: (room, p, b, now) => homestead.counter(room as homestead.Room, p, { offerId: b.offerId, give: b.give, want: b.want }, now),
    accept: (room, p, b, now) => homestead.accept(room as homestead.Room, p, { offerId: b.offerId }, now),
    refuse: (room, p, b, now) => homestead.refuse(room as homestead.Room, p, { offerId: b.offerId }, now),
    cancel: (room, p, b, now) => homestead.cancel(room as homestead.Room, p, { offerId: b.offerId }, now),
    skip: (room, p, _b, now) => homestead.skip(room as homestead.Room, p, now),
    end: (room, p, _b, now) => homestead.end(room as homestead.Room, p, now),
  },
},
```

Shared-file edits (append-only, one line or block each): `GAME_IDS` + import + `GAMES` entry in `catalogue.ts`; `TITLES.homestead = 'Homestead'` in `invite-push.server.ts`; `pace`, `deadlineHours`, `island` in `startGame`'s options in `api.server.ts` (the durable branch adds the same three keys: whichever merges second drops its duplicate); `case homestead` in the app's `GameKind` (title "Homestead", line "Settle an island. Trade, build, race to the points.").

`waitingOn(room)`: `setup`/`roll`/`fox`/`main`/`roads` → `[activeId]`, key `"<turn>:<step>:<activeId>"`; `discard` → everyone still owing, key `"<turn>:discard"`; `line` e.g. "Robin rolled a 9." / "Sam rolled a 7: discard 4." / "Your turn to place a cottage."

## Wire (`toWire(room, meId, now)`)

Built per viewer. **Hidden**: other players' resource cards (count only), every unplayed almanac card (count only, including heirlooms; mine are listed for me), the deck order, the rng, which card a steal took (thief and victim only). Everything else is public. A leak test plays a seeded 5-player game to the end and, after every move, asserts each viewer's JSON contains no other player's `hand`/`cards`, no `rng`, no `deck`, and that log texts for steals name the resource only for the two involved.

Shared fields as every game: `id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `phaseEndsAt`, `players`, `standings`, `winnerIds`, `serverNow`; plus from the registry for durable rooms `durable`, `pace`, `version`, and `sawInvite` on players.

Example: John (active, `main`) viewing a 3-player easy async game (trimmed arrays; ids illustrative).

```json
{
  "id": "g_4be1c2d09a7f", "game": "homestead", "difficulty": "easy", "phase": "playing",
  "step": "main", "hostId": "p_a1", "meId": "p_a1", "pace": "async", "durable": true, "version": 212,
  "deadlineHours": 24, "vpTarget": 8, "island": "standard", "turn": 17, "activeId": "p_a1",
  "phaseEndsAt": 1761300000000, "startedAt": 1761200000000,
  "board": {
    "hexes": [
      { "id": "0,0", "q": 0, "r": 0, "kind": "dunes", "token": null, "pips": 0 },
      { "id": "1,-1", "q": 1, "r": -1, "kind": "fields", "resource": "grain", "token": 8, "pips": 5 }
    ],
    "harbours": [ { "edge": "1,-2,NE", "kind": "any", "rate": 3 }, { "edge": "2,-2,W", "kind": "wool", "rate": 2 } ]
  },
  "fox": "0,0",
  "buildings": [ { "at": "1,-1,N", "owner": "p_a1", "piece": "cottage" }, { "at": "0,1,S", "owner": "p_b2", "piece": "town" } ],
  "roads": [ { "at": "1,-1,NE", "owner": "p_a1" } ],
  "seats": ["p_a1", "p_b2", "p_c3"],
  "dice": { "a": 4, "b": 5, "total": 9, "by": "p_a1", "at": 1761213000000 },
  "setup": null,
  "freeRoads": 0,
  "discardOwed": {},
  "me": {
    "hand": { "timber": 2, "clay": 1, "wool": 0, "grain": 3, "stone": 1 },
    "cards": [ { "kind": "ranger", "new": false }, { "kind": "heirloom", "new": true } ],
    "vp": 6, "playedCardThisTurn": false,
    "rates": { "timber": 4, "clay": 4, "wool": 2, "grain": 4, "stone": 4 }
  },
  "legal": {
    "road": ["1,-1,NW", "2,-2,W"], "cottage": [], "town": ["1,-1,N"], "fox": [], "victims": {},
    "canRoll": false, "canBuy": true, "canEnd": true, "playable": ["ranger"], "canTrade": true
  },
  "players": [
    { "id": "p_a1", "name": "John", "status": "joined", "isHost": true, "seat": 0, "colour": "red",
      "handCount": 7, "cardCount": 2, "rangersPlayed": 1, "publicVp": 5, "trail": 4,
      "longestTrail": false, "chiefRanger": false, "pieces": { "road": 9, "cottage": 2, "town": 3 },
      "away": false, "sawInvite": true },
    { "id": "p_b2", "name": "Robin", "status": "joined", "isHost": false, "seat": 1, "colour": "blue",
      "handCount": 4, "cardCount": 1, "rangersPlayed": 3, "publicVp": 6, "trail": 5,
      "longestTrail": true, "chiefRanger": true, "pieces": { "road": 7, "cottage": 3, "town": 3 },
      "away": false, "sawInvite": true }
  ],
  "bank": { "timber": 12, "clay": 14, "wool": 15, "grain": 9, "stone": 13 },
  "deckCount": 17,
  "costs": { "road": { "timber": 1, "clay": 1 }, "cottage": { "timber": 1, "clay": 1, "wool": 1, "grain": 1 },
             "town": { "grain": 2, "stone": 3 }, "card": { "wool": 1, "grain": 1, "stone": 1 } },
  "showCosts": true,
  "offers": [
    { "id": "o7", "from": "p_a1", "to": null, "give": { "grain": 1 }, "want": { "stone": 1 },
      "status": "open", "refusedBy": ["p_c3"], "counterTo": null, "at": 1761213100000 },
    { "id": "o8", "from": "p_b2", "to": ["p_a1"], "give": { "stone": 1 }, "want": { "grain": 2 },
      "status": "open", "refusedBy": [], "counterTo": "o7", "at": 1761213150000 }
  ],
  "hints": {
    "affordable": ["road", "town", "card"],
    "trades": [ { "give": "wool", "count": 2, "get": "stone", "for": "town" } ],
    "tip": "A town makes two of everything its cottage made."
  },
  "log": [
    { "n": 140, "at": 1761213000000, "kind": "roll", "by": "p_a1", "text": "John rolled 9.", "auto": false },
    { "n": 141, "at": 1761213000000, "kind": "produce", "by": null, "text": "9: John +1 grain, Robin +2 stone.", "auto": false },
    { "n": 139, "at": 1761212000000, "kind": "steal", "by": "p_b2", "text": "Robin's fox took a wool from you.", "auto": false }
  ],
  "result": null, "standings": null, "winnerIds": [], "serverNow": 1761213200000
}
```

The same moment as Robin sees it differs only in: `meId: "p_b2"`; `me` is Robin's hand, cards, `vp` and `rates`; `legal` is Robin's (in a 3-player game, off-turn, so everything empty/false except `canTrade: false`); `hints` are Robin's; the steal log line reads "Your fox took a wool from John."; and to Sam (`p_c3`) it reads "Robin's fox took a card from John." No other field changes by viewer.

Field notes:

- `board.hexes[]`: `kind` = `woods` \| `claypit` \| `meadow` \| `fields` \| `quarry` \| `dunes`; `resource` absent on dunes; `token` null on dunes. The app derives vertices and edges from the hexes with the formulas above (they are not sent).
- `harbours[].edge` is a coastal edge id; its two vertices trade at `rate`.
- `setup` while `step === "setup"`: `{ "round": 1 | 2, "need": "cottage" | "road", "cottage": vertexId | null }`.
- `discardOwed`: `{ playerId: count }` for everyone still owing in `discard` (public: it is a count). `me` has no separate field; `discardOwed[meId]`.
- `legal` is only ever the viewer's own options at this instant, already allowing for cost, pieces, step and turn: `road`, `cottage`, `town` (ids), `fox` (hex ids), `victims` (`{ hexId: [playerId] }` for each legal fox hex with eligible victims), `canRoll`, `canBuy`, `canEnd`, `playable` (card kinds), `canTrade`. In `roads`, `road` lists the free-road edges.
- `players[].colour` by seat: `red`, `blue`, `amber`, `green`, `purple` (the app draws each with a distinct shape mark too, for colour-blind players). `trail` is the length of their longest trail.
- `log`: the last 50 entries, oldest first (the room keeps 200). `kind`: `setup`, `roll`, `produce`, `discard`, `fox`, `steal`, `build`, `buy`, `play`, `bank`, `trade`, `offer`, `award` (Longest Trail / Chief Ranger changes hands), `turn`, `away`, `leave`, `finish`. `text` is per viewer.
- `result`: `{ "winnerId": id | null, "reason": "points" | "left" | "abandoned" }`.

Finished wire (everyone): `phase: "finished"`, every player's `heirlooms` count revealed on `players[]`, `me` still mine only, and:

```json
"standings": [
  { "id": "p_b2", "name": "Robin", "place": 1, "score": 10, "vp": 10, "heirlooms": 1, "cottages": 2, "towns": 3,
    "trail": 7, "longestTrail": true, "chiefRanger": true, "result": "won", "left": false },
  { "id": "p_a1", "name": "John", "place": 2, "score": 8, "vp": 8, "heirlooms": 1, "cottages": 2, "towns": 2,
    "trail": 4, "longestTrail": false, "chiefRanger": false, "result": "lost", "left": false }
],
"winnerIds": ["p_b2"]
```

Standings: winner first, then VP descending (equal VP share a place), leavers last. `score` = final VP including heirlooms, so the leaderboard's default high score is "most points in a game" and wins rank the overall board; no `resultScore` needed. An abandoned game has no standings and records nothing.

## App

- `HomesteadBoardView`: the island drawn in one `Canvas` (hexes as `Path`s with resource colours and a small resource glyph so colour is not the only cue; tokens as discs, 6/8 emphasised; harbours as pier marks with "3:1" / "2:1 wool"), pieces drawn by owner colour + shape. Pan (`DragGesture`) and pinch zoom (`MagnifyGesture`, 0.6× to 3×), double-tap to fit. Taps hit-test the nearest vertex/edge/hex in board space within 22 pt (scaled), but only against the ids in `legal` for the chosen action, which are drawn lit (pulsing rings on vertices, thick dashes on edges, outlined hexes for the fox). Picking a piece first: bottom bar "Road / Cottage / Town / Card"; hard hides the cost card and lights targets only after a piece is picked.
- Sheets: Hand (my cards by resource, almanac cards with Play), Bank (rates from `me.rates`, give/get steppers limited to what I hold), Trade (compose an offer, list of all offers with Accept / Counter / Refuse / Cancel per role), Discard (forced, pick exactly `discardOwed[me]`), Fox victim picker.
- Dice: two dice tumble ~0.8 s when `dice.at` changes, then settle on `a`/`b` (Reduce Motion: no tumble). Event log as a scrolling list; VP summary strip with each player's colour mark, `publicVp`, hand and card counts, trail and ranger badges, and a ticking deadline (TimelineView) for whoever the room waits on.
- Dynamic Type: no fixed-height text containers; the board is independent of type size, the sheets scroll, the bottom bar wraps to two rows at accessibility sizes. VoiceOver: each lit target is an accessibility element ("Cottage spot, fields 8 and quarry 5").
- `GamesDemoFixtures`: a `-SRDemo` Homestead room in `setup`, one in `main` with offers open, one in `discard`, one `finished`; plus the lobby rows (durable spec).
- XCTest (`HomesteadTests.swift`): hex corner and edge ids, vertex/edge neighbour sets, edge endpoints, board counts (54/72, 84/114) from the demo fixtures' hexes, pixel round-trip (id → point → nearest id), legal-target hit-testing only returns ids in `legal`, decoding of every fixture (and of a wire missing optional fields), a log entry of an unknown kind decodes.

## Tests (server)

`homestead-board.test.ts`: geometry identities, counts, harbour spacing, 500 seeded islands per size pass the balance rules, the fallback passes. `homestead.test.ts` / `homestead.play.test.ts`: a seeded 3-player and 5-player game played to a win through moves only; snake setup order and second-cottage production; distance and connectivity; bank shortage rule; 7 with discards (simultaneous, timeout auto-discard); friendly fox on easy; steal randomness hidden; each almanac card incl. bought-this-turn and one-per-turn; Longest Trail with a break by an opponent's cottage and the tie rule; Chief Ranger; offers (accept executes, first wins, void when cards gone, cancelled at end of turn, counters); open building in 5-player; off-turn target reached wins at turn start; leaving; away and abandoned; every timeout's auto-move is legal; `resume` restarts a live timer; JSON round-trip of the room at every step (durable contract); the per-viewer leak test; `toWire` sizes stay under 40 KB on the large island.

## Not built

A 2-player game (start refuses fewer than 3). Web play (`/games/homestead` says "open in the app"). Seafaring, scenarios or extra expansions. Player-to-player trades not involving the active player. Choosing which card a `market`/`harvest` shows in the log beyond counts. Undo. Bots to fill seats.
