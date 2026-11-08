# Family games: Azul, with an optional TV board

2026-10-31. John: "build an apple-app game of Azul for family play. The board would be visible on
strangeramblings.com/games/azul and I'd cast that to the TV, and each apple app would have the player's
controls … design the components in a way that would support more games." Then: "add the option to play
without a central board or with it (so not dependent on us all seeing the sr board)".

## Shape

- **Rules** `src/lib/games/azul.ts` — the standard game for 2–4, pure functions over a room, in the
  Homestead shape: durable (`game_rooms`, schema 1), paces `live` | `async`, own seeded sfc32 in the room,
  `waitingOn` + `resume`. One move: `take {source, colour, line}`.
- **The phones show everything.** Every phone draws the factories, the centre and every player's board,
  so a game never needs the TV. The host picks `table: 'phones' | 'tv'` when starting; `tv` only makes
  the app lead with "Show on TV" in the lobby and keep other players' boards a tap away instead of open.
- **TV board** (`/games/<game>`, any game whose rules define `toScreen`) — PUBLIC, because a TV has no
  login. The page opens one SSE stream and shows a four-letter code. A player in a room taps
  "Show on TV" and types the code; the stream is then sent an HMAC ticket for that room and the table.
  The ticket (12 h) survives a reload or deploy; a room that goes away sends the screen back to a code.

Generic pieces for the next game with a TV board: `GameRules.toScreen`, `rooms.server` `watch` /
`screenGame`, `screens.ts` (code + ticket), `screens.server.ts` (registry + stream), the `screen`
room action, `screens` in the lobby, `TableScreen.svelte` (code / waiting / ended chrome), and a
board component per game in `src/lib/components/games/<game>/`.

## Rules as built

- Factories: 5 / 7 / 9 for 2 / 3 / 4 players, four tiles each; 20 tiles of each of blue, yellow, red,
  black, white. Bag refills from the lid when it runs dry.
- A turn takes every tile of one colour from a factory (rest to the centre) or from the centre (the first
  to do so takes the first-player marker onto their floor and starts next round). Onto a pattern line
  (line n holds n; empty or same colour; wall row must not already hold the colour) or the floor;
  overflow to the floor; past seven floor spaces, to the lid for nothing.
- Round end: each full line moves one tile to the wall (fixed pattern: column = (colour index + row) mod 5),
  scoring 1, or the row run (if >1) plus the column run (if >1). Floor costs 1,1,2,2,2,3,3; score never below 0.
  A `scoring` phase holds 6.5 s for the table to watch.
- The round in which someone completes a wall row is the last. Bonuses: +2 a row, +7 a column, +10 a colour
  placed five times. Most points wins; tie → most complete rows; still tied → shared.
- Clock: live turns 180 / 90 / 45 s (easy / medium / hard); async = the host's 12 / 24 / 48 h. A turn that
  runs out is auto-played (most tiles onto a line, fewest on the floor, prefer completing) and the player
  is "away" (20 s live / 1 h async) until they move.
- Leaving mid-game: their board stays, they are skipped; one left ends the game (`reason: 'left'`).

## Wire (`toWire(room, meId)`; the TV gets the same with `meId: ''`)

```
{ id, game:'azul', difficulty, phase: lobby|countdown|playing|scoring|finished|closed,
  hostId, meId, table:'phones'|'tv', turnMs, deadlineHours|null, startedAt, phaseEndsAt,
  round, lastRound, turnId, turnStartedAt,
  colours:['blue','yellow','red','black','white'],
  factories: [[{id,c}]], centre: [{id,c}], firstInCentre, bag:n, lid:n,
  canPlace: { <colour>: [line indexes] }   // ONLY to the mover, only colours on offer; floor always allowed
  last: {by, source:'centre'|n, colour, tiles:[id], line:n|'floor', overflow, toCentre:[id], tookFirst, auto, at} | null,
  roundScores: [{id, placements:[{line,col,tile,points}], floor, before, after}] | null,   // during/after scoring
  log: [{n, at, by, text, auto}]  // last 8
  players: [{id, name, status, isHost, seat, score, away, lines:[[{id,c}]x5], wall:[[id|null]x5]x5,
             floor:[{id, c: colour|'first'}], floorPenalty, rows, hasFirst}],
  result: {winnerIds, reason:'wall'|'left'|'tiles'} | null,
  standings: [{id,name,place,score,rows,bonus:{rows,columns,colours,points}|null,result:'won'|'lost'|'drew'|'left'}] | null,
  winnerIds, serverNow, + registry: durable:true, pace, version, players[].sawInvite }
```

Tile ids are stable for the whole game (0–99; the marker is 100), so a board can fly a tile from where
it was to where it is. Wall square colour is implied: `COLOURS[(col - row) mod 5]`.

Moves: `POST /api/native/games/<id>` `{action:'take', source:'centre'|<factory index>, colour, line:<0-4>|'floor'}`.
Pairing: `{action:'screen', code:'BCDF'}` → 200 with the room; 404 "No TV is showing that code…",
409 different game, 400 bad letters / no TV board. Start: `POST /api/native/games`
`{game:'azul', difficulty, invite, table:'tv'|'phones', pace, deadlineHours}`. Lobby `screens: ['azul']`.

## Release

SR-Main first (additive: a new game id, a public page + stream, two optional lobby fields). No schema
change (`game_rooms` exists and is granted). App: TestFlight from the branch for John first; merge to
the app's main only on his say-so.
