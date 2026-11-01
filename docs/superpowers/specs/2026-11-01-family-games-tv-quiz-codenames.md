# Family games on the TV: Quiz Night's board, and Codenames

2026-11-01. John: "build quiz night and codenames for the tv". Builds on the generic TV board from
`2026-10-31-family-games-azul.md` (`GameRules.toScreen`, `/games/<game>`, pairing code, `screen` action).

## Quiz Night on the TV

- `quiz-night.ts` `toScreen(room, now)` = `toWire(room, '', now)`: the question and options, who has
  answered (`answeredIds`, never what), and at the reveal the right answer, every pick and the points.
  `myChoice` is null and `review[].myChoice` null. Nothing new is sent to the phones.
- The board (`QuizTable.svelte`): lobby with the topic and jkai writing the questions; a 3-2-1;
  the question large with the four options in a 2×2 of lettered colour blocks and a draining clock;
  each player's chip lights as they answer; the reveal greys the wrong options, lifts the right one,
  lists who picked each, pops the points and re-orders the scores; the final podium and standings.
- App: Quiz Night's room screen gets the same "Show on TV" toolbar button and sheet as Azul
  (`GameShowOnTVToolbarButton`, `GameScreenPairingSheet`), offered when `lobby.screens` has `quiz-night`.

## Codenames

Rules `src/lib/games/codenames.ts` (Azul shape: durable schema 1, own sfc32, `waitingOn`, `resume`, live only).

- 25 words (`words/codenames.ts`, our own list of everyday double-meaning words) in a 5×5 grid. The key:
  9 for the starting team, 8 for the other, 7 bystanders, 1 assassin.
- **Teams** (4–8 joined): red and blue, a spymaster each. In the lobby each player picks a team (or
  anywhere) and whether they'd like to give clues (`team` move). At the start, picks are kept where each
  side still has two; the rest fill the smaller side; a team's spymaster is whoever asked, else someone who
  has not had a go (`again` rotates), else anyone. The starting team is random.
- **Co-op** (2–3 joined): everyone on red, one spymaster, red starts with 9. After each red turn one blue
  agent turns itself over (`by: 'auto'`). Red wins by finding all nine; loses on the assassin or when the
  eight blue agents are all turned.
- **Turn**: phase `clue` — the turn team's spymaster sends one word and a number 1–9. The word must be one
  word of letters (inner hyphen/apostrophe fine), ≤ 24, and not a face-down word, its root (One Clue's
  `sameStem`), inside one, or holding one (≥ 3 letters). Then phase `guess` — the team's operatives touch
  cards (the first touch lands; a second touch of the same card is a no-op), up to number + 1. Own agent →
  go on; bystander or the other team's agent → turn ends (that agent counts for them); assassin → that team
  loses. `pass` ends the turn after at least one guess. A team whose only player left is its spymaster:
  the spymaster guesses too.
- **End**: a team with every agent turned wins at once (even turned by the other team); assassin; a team
  with nobody left loses (`reason: 'left'`).
- **Clock**: clue and guess 300 / 150 / 90 s (easy / medium / hard). No clue in time: the turn passes.
  Guessing out of time (+750 ms grace): the turn ends.
- **Leaving**: a spymaster's role passes to a team-mate. Co-op with one left ends the game.
- **Results**: standings `place` 1 for the winning team, 2 otherwise; `score` = the team's agents found.
  Leaderboard ranks by `place` (`resultRank`); `resultScore` null.

### Wire (`toWire(room, meId)`; the TV gets `meId: ''`)

```
{ id, game:'codenames', difficulty, phase: lobby|countdown|clue|guess|finished|closed,
  hostId, meId, mode:'teams'|'coop'   // in the lobby: what the joined count would play
  clueMs, guessMs, startedAt, phaseEndsAt, starting:'red'|'blue', turnTeam:'red'|'blue', turns,
  cards: [{i, word, kind: 'red'|'blue'|'neutral'|'assassin'|null /* null = face down */, by: id|'auto'|null, turn}],
  key: [kind x25] | null        // ONLY a spymaster (once dealt), and everybody when finished
  clue: {team, by, word /* upper case */, count, cards:[i], at, guessesLeft} | null,
  clues: [{team, by, word, count, cards:[i], at}],   // every clue, oldest first
  teams: [{team, agents, left, spymasterId|null}]    // red then blue (co-op: blue's spymaster null)
  last: {card, kind, team, by: id|'auto', at} | null,
  canGuess, canClue,          // for this phone
  players: [{id, name, status, isHost, team:'red'|'blue'|null, spymaster}],
  result: {winner:'red'|'blue'|null /* null = co-op lost */, reason:'agents'|'assassin'|'left'} | null,
  standings: [{id,name,team,spymaster,score,place,result:'won'|'lost'|'left'}] | null,
  winnerIds, serverNow }
```

Moves (`POST /api/native/games/<id>`): `{action:'team', team:'red'|'blue'|null, spymaster:bool}` (lobby),
`{action:'clue', word, count}`, `{action:'guess', card:<0-24>}`, `{action:'pass'}`. Errors are 400/403/409
with a sentence (`"Too close to SNOWMAN."`, `"That is a word on the board."`). Start: `POST /api/native/games`
`{game:'codenames', difficulty, invite}`; up to 8 players. Lobby `screens` gains `quiz-night`, `codenames`.

The TV board (`CodenamesTable.svelte`): the grid large, cards flipping to their agent's colour as they
are touched (with a stamp of who); both teams' agents-left as pips with their spymaster and operatives;
the clue as a banner with the guesses left; each team's clue history; the clock. At the end the rest of
the key fades in under the face-down cards and the winner's banner shows. Before the end the TV never
holds the key (`toScreen` key null; a face-down card's kind null).

## Release

SR-Main first (additive: a new game id, `toScreen` on two games). No schema change. App: TestFlight from
the branch for John first; merge to the app's main only on his say-so.
