# Family games leaderboard

Status: built 2026-09-29. Repos: SR-Main (recorder, `game_results`, API, `/games/leaderboard`), SR-AppleApp (Leaderboard screen off the Games tab).

## Recording

`rooms.server.ts` hands a room to the recorder once each time it reaches `finished` (`record()`, called from `settle` and from `act`'s catch-up, so a round that finished just before "Play again" is still recorded). The rows come from the game's OWN finished wire — `standings` + `winnerIds` — via `roundRows` in `results.ts`, so a new game records with no change here:

- `score` = the standing's numeric `score`; a game whose best-of number is named differently sets `GameRules.resultScore` (Sequence Memory: `best`). No number → `null`, and that game's board ranks by wins (Wordle Race, Liar's Dice).
- `rank`: winners share 1, equal scores share a place, otherwise position. `won` is membership of `winnerIds` (empty for a solo round — solo rounds are recorded and count for high scores).
- `round`: a per-room counter; "Play again" is the next round. Unique `(room_id, round, player_id)` + `ON CONFLICT DO NOTHING` makes a replay a no-op.
- `options`: each create-request key the room holds as a plain value (Boggle `size`, `seconds`, `scoring`) plus `label` = the game's `about(room)`.
- Fire-and-forget: a DB failure is logged, never thrown into a game.
- `player_id` is `playerId(email)` (keyed hash); no email is stored. Account deletion (`people/erase.ts`) erases a person's rows.

## Records on the wire

After the insert resolves, `recordRound` compares the round's top score against the best from every OTHER round in today / this week / all time and returns `{ playerId: 'day'|'week'|'all' }` (the widest window beaten; a record needs a previous score to beat). If non-empty, the finished room re-broadcasts with `records`. It is cleared when the room leaves `finished`.

## Windows

Europe/London: day = London midnight; week = London midnight on Monday; all = no bound. Computed explicitly (`windowStart`), correct across both clock changes on a UTC server.

## API

| Route | Auth | Answer |
|---|---|---|
| `GET /api/native/games/leaderboard?window=day\|week\|all` | `withNativeAccess('games')` | `{ me:{id}, window, from, overall:[{rank,playerId,name,wins,played}], games:[{game,title,scored,rows:[{rank,playerId,name,best,bestLabel,wins,played}]}] }` |

Default window `week`; anything else 400. Names only.
