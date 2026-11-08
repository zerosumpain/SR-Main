# Family games: Secret Mission

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/mission.ts`, catalogue entry `mission`), SR-AppleApp (`Games/Mission*.swift`). The leaderboard needs nothing new: the game has no score, so its board ranks by wins, and every player on the winning side wins the round.

A hidden-roles team game for five to ten people sitting together. The talking happens out loud, round the table; the phones hold only the secrets and the votes. The names, roles and wording are our own.

## The table

The table is split in secret into the **crew** and the **spies**. Spies know each other; the crew know nobody.

| Players | Crew | Spies | Team for missions 1–5 |
|---|---|---|---|
| 5 | 3 | 2 | 2, 3, 2, 3, 3 |
| 6 | 4 | 2 | 2, 3, 4, 3, 4 |
| 7 | 4 | 3 | 2, 3, 3, 4, 4 |
| 8 | 5 | 3 | 3, 4, 4, 5, 5 |
| 9 | 6 | 3 | 3, 4, 4, 5, 5 |
| 10 | 6 | 4 | 3, 4, 4, 5, 5 |

At seven or more the fourth mission needs **two** Sabotage cards to fail. Five is the target table (the family); `start` refuses fewer than five (409), and the room holds up to ten — the one game whose cap is not the shared five (`GameRules.maxPlayers`, read by `startGame` and `inviteTo`).

## A round

1. **Roles** (`roles`): every phone shows its own role card. Spies see the other spies; the Lookout sees every spy. The phase ends when everyone taps *Got it* or after 30 s.
2. **Proposal** (`proposing`): the leader picks a team of the mission's size, from anybody seated (themselves included).
3. **Vote** (`voting`): everyone votes approve or reject at once. Nobody's vote is shown until the last is in (or the clock runs out).
4. **Tally** (`tally`, 6 s): every vote shown together. A strict majority approves (a tie rejects). Rejected: the lead passes to the next seat and the round goes back to 2. **Five rejected proposals in a row win the game for the spies.** An approved team resets the count.
5. **Mission** (`mission`): each team member secretly plays Succeed or Sabotage. The crew can only succeed — the server refuses Sabotage from a crew phone (400 "The crew can only play Succeed."). The phone does not even offer it.
6. **Outcome** (`outcome`, 7 s): the table learns how many Sabotage cards were played — never who played them. The lead passes on.

First side to three missions wins. If the crew get there with the special roles in play, the **hunt** begins (`hunt`, 90 s): the spies are shown to everyone, talk it over out loud, and the Tracker names one crew member. Naming the Lookout steals the win for the spies.

## Difficulty

| Level | Roles | Leader's clock | Vote clock | Mission clock |
|---|---|---|---|---|
| easy | crew and spies only | 120 s | 60 s | 45 s |
| medium | + Lookout (crew, knows the spies) and Tracker (spy, gets the hunt) | 90 s | 45 s | 30 s |
| hard | + Lookout and Tracker | 60 s | 30 s | 20 s |

Easy is the first game for a family that has never played this kind of thing: nobody but the spies knows anything. Medium and hard give the crew an informant they must protect — the Lookout has to steer the table without being obvious — and hard puts it all on a shorter clock.

## Timeouts — the room never freezes

Every clock running out is a server move (`advance`), one step per call, every next deadline set from `now`, and `advance(room, NaN)` moves nothing.

- The leader's clock: a team is drawn at random, players still here first (`autoTeam`), marked `autoTeam` on the wire.
- The vote clock: every missing vote approves (listed in the tally's `auto`).
- The mission clock: every missing card succeeds.
- The roles card: play moves on after 30 s whether or not everyone tapped *Got it*.
- The hunt: no name in 90 s and the crew keep the win.

## Leaving mid-game

The leaver keeps their seat and their secret, and the server plays for them from then on: their vote approves, their card succeeds, the lead skips them. A leader who leaves passes the lead on with a fresh clock. A Tracker who leaves the hunt forfeits the guess (crew win). A host who leaves hands the host role to the next player. If fewer than three people are left the game ends. A result already earned stands: on the outcome screen after a side's third mission, on the tally after the fifth rejection, or during the hunt (crew win). Otherwise it is `reason: "abandoned"`, every role is shown and nobody wins. A player who left before the finish is never counted a winner, even if their side wins. Standings are frozen at the finish, so leaving from the results screen does not change who won.

## Moves (`POST /api/native/games/<id>`)

| Body | Does |
|---|---|
| `{ action: "ready" }` | I have read my role card. |
| `{ action: "propose", team: [playerId] }` | Leader only, while proposing. 400 with a sentence for the wrong size, a repeat, or somebody not at the table; 409 if you are not leading. |
| `{ action: "vote", approve: true \| false }` | Seated players, while voting. One vote each (409 on a second). |
| `{ action: "play", card: "succeed" \| "sabotage" }` | Team members, on the mission. Crew sabotage is 400. |
| `{ action: "guess", playerId }` | The Tracker, in the hunt. 400 for a spy or somebody not seated. |

## Wire (`toWire`, per viewer)

Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `startedAt`, `phaseEndsAt`, `players`, `standings`, `winnerIds`, `serverNow`):

- Table: `rule` (the level in a sentence), `specials`, `minPlayers`, `maxPlayers`, `seats`, `spyCount`, `teamSizes[5]`, `sabotagesNeeded[5]`, `proposeMs`, `voteMs`, `missionMs`, `huntMs`.
- Play: `mission` (1-based), `attempt`, `rejections`, `maxRejections`, `leaderId`, `team` (only while voting, tally, mission, outcome), `autoTeam`, `score: { crew, spies }`, `trackerId` (only in the hunt and at the finish).
- `secret` — **mine only**: `{ role: crew|spy|lookout|tracker, side: crew|spies, spies: [playerId], vote, card }`. `spies` is filled for a spy (the others) and the Lookout (all of them), empty for the crew. `vote` is my own vote while voting; `card` my own card on the mission. Null for somebody not seated.
- Each player: `seated`, `ready`, `voted` (while voting — whether, not how), `onTeam`, `played` (on the mission — whether, not what), `role` (null until finished), `side` (`spies` for spies in the hunt; everyone's at the finish).
- `tallies`: every decided proposal, `{ mission, attempt, leaderId, team, approve, reject, auto, approved, autoTeam }`. Public: the votes were shown together.
- `missions`: `{ mission, leaderId, team, needed, sabotages, succeeded }` — counts only.
- `result: { winner: crew|spies|null, reason: missions|sabotage|rejections|hunt|abandoned, guessId }` once finished.

What never reaches another phone: anyone's role before the finish, a vote before the tally, a mission card ever (only the count). `mission.test.ts` builds the wire for every seat and searches its JSON, and checks that a crew phone's wire is byte-identical when two other players' roles are swapped.

Standings (finished): the winning side first, `{ id, name, place, role, side, won, left }`; place 1 for the winners still at the table, 2 for everyone else; all at place 1 with `winnerIds` empty when the game was abandoned.

## Not built

- Loyalty checks (one player inspecting another's side), extra roles (a spy hidden from the Lookout, a crew member who sees the Lookout), or choosing roles by hand: the three levels are the whole menu.
- A web page: `/games/<id>` says "open in the app", as for every game but Liar's Dice.
- In-app chat: the game is played in one room, out loud.
- A "your turn to lead" push: the invite push exists; the phone buzzes when it opens on its own turn.
