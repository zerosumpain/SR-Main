# Family games: Chess

Status: built 2026-10-21. Repos: SR-Main (`src/lib/games/chess-engine.ts`, `chess.ts`, catalogue entry `chess`), SR-AppleApp (`Games/Chess*.swift`). The leaderboard needs nothing: chess has no score, so its board ranks by wins (a draw counts as played, not won).

## The game

Two players, a clock each. The host's difficulty is the time control:

| Level | Each side | Back per move |
|---|---|---|
| easy | 15 min | +10 s |
| medium | 10 min | +5 s |
| hard | 5 min | +3 s |

The first game's colours come from the rng; "Play again" with the same two swaps them. Run out of time and you lose — unless the other side has nothing that could ever mate (a bare king, or king and one minor piece), which is a draw. Checkmate, stalemate, the fifty-move rule, threefold repetition and insufficient material end the game by themselves. Either player may resign at any time, or offer a draw; an offer stands until the other side moves (declining it) or offers too (accepting it). Leaving a game in play forfeits it. Nothing is auto-moved: there is no turn clock, only the game clock.

The laws of chess are `chess-engine.ts`, pure over a `Position` (64 squares, a1 = 0), proven by perft against the six standard positions (`chess-engine.test.ts`). Castling, en passant, promotion, pins, check, SAN with disambiguation.

## Lobby

`createRoom` refuses more than one invitee (400 "Chess is for two: invite one person."); `start` needs exactly two joined (409 otherwise). The app's new-game sheet lets the host pick one person.

## Moves (`POST /api/native/games/<id>`)

| Body | Does |
|---|---|
| `{ action: "move", from: "e2", to: "e4" }` | On your turn. 400 with a sentence for an illegal move, a square that is not yours, or a pawn reaching the last rank without `promotion` (`q` \| `r` \| `b` \| `n`); 409 off-turn. Your clock is charged for the time you took, then the increment is added; a move that lands after your flag loses on time instead. |
| `{ action: "resign" }` | Either side, any time in play. |
| `{ action: "draw" }` | Offer; or accept the other side's standing offer. |

## Wire (`toWire`)

Nothing is hidden in chess. Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `startedAt`, `phaseEndsAt`, `players`, `standings`, `winnerIds`, `serverNow`):

- `fen`: the position. `turn`: `w` \| `b`. `turnId`: whose move. `turnStartedAt`: when the running clock started.
- `clocks: { w, b }`: ms left on each clock **as of `turnStartedAt`**; the phone subtracts `serverNow − turnStartedAt` from the side to move. `mainMs`, `incrementMs`, `rule` (the control in a sentence).
- `legal`: `[{ from, to, promotes }]`, sent only to the player whose move it is (empty otherwise); one entry per square pair, `promotes: true` when the phone must ask which piece.
- `check`: the side to move is in check. `lastMove: { from, to } | null`. `moves`: SAN, oldest first. `captured: { w: [kinds], b: [kinds] }`: what each side has taken, in order.
- `whiteId`, `blackId`. `drawOfferBy`. `result: { outcome, winnerId } | null` where outcome is `checkmate` \| `stalemate` \| `insufficient` \| `fifty-moves` \| `repetition` \| `resigned` \| `timeout` \| `agreed` \| `left`.
- Each player: `seated`, `colour`, `clockMs`.
- `phase`: `lobby` \| `countdown` \| `playing` \| `finished` \| `closed`. `phaseEndsAt` while playing is the side to move's flag.

Standings: winner first, `{ id, name, place, colour, result: won|lost|drew, clockMs }`; a draw has both at place 1 and `winnerIds` empty.

## Not built

A "your move" push. The invite push exists (`invite-push.server.ts`), but a push for every move would ring a phone that is already looking at the board; it wants the app to suppress a banner for the room on screen first.
