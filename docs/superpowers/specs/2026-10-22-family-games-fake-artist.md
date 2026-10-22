# Family games: Fake Artist

Status: built 2026-10-22. Repos: SR-Main (`src/lib/games/fake-artist.ts`, word list `src/lib/games/words/fake-artist.ts`, catalogue entry `fake-artist`), SR-AppleApp (`Games/FakeArtist*.swift`). A drawing-and-bluffing game for four to ten; the leaderboard needs nothing new (standings carry a numeric `score`, the total points).

The mechanics are inspired by a commercial party game. The name, word list, copy and rules text here are our own.

## The game

Four to start, up to ten (this game's own cap, `GameRules.maxPlayers`, above the registry's default of five). A game is 3 or 5 rounds, the host's choice (`rounds`, default 3).

Each round:

1. **Reading** (8 s). The server deals a category and a secret word from the curated list, and one player is the **fake**. Everyone sees the category; the artists see the word; the fake sees only "You're the fake". Nobody but the fake knows who the fake is.
2. **Drawing.** Twice round the table, in seat order starting one seat further on each round, each player adds **one continuous line** (finger down to finger up) to a shared picture in their own colour. The finger lifting ends the turn. A turn not finished in time ends on its own: a line begun stays as far as it got, no line at all is a skip.
3. **Voting** (60 s). Everyone, the fake included, votes for who they think the fake is (not themselves). A vote may be changed until everyone has voted; the vote closes when everyone has, or on the clock (no vote = abstain).
4. If the fake has **more votes than every other player, alone**, they are caught and get **one guess** at the word (30 s). Otherwise (a tie, nobody voted, or an artist accused) the fake has escaped.
5. **Reveal** (10 s): the word, the fake, every vote, the guess and the points.

Points: the fake escaping, or caught but naming the word, scores **2 for the fake**. The fake caught and missing (or not guessing in time) scores **1 for each artist** in the round. The winner is the top total after the last round; ties share; nobody wins on 0.

The fake is dealt at random among the players still in, but **never the same player two rounds running**. Words are never repeated within a game.

The guess is fuzzy: case, accents, punctuation, a leading article, a plural `s` and spaces are ignored (Draw & Guess's `normalise`), and a word of five letters or more also accepts one letter off. "kalidoscope" names "kaleidoscope"; "bat" does not name "cat".

## Difficulty

| Level | Words | A line's turn |
|---|---|---|
| easy | each category's commonest words | 30 s |
| medium | common and well-known words | 20 s |
| hard | less common members of the category | 15 s |

A harder word gives the fake less to go on from the category, and makes the artists draw more carefully to be recognised without giving it away; a shorter turn leaves less time to think.

## Words

`words/fake-artist.ts`: 16 categories (animals, food, in the house, things that go, sports and games, weather and sky, jobs, places, toys, clothes, music, under the sea, fairy tales, in the garden, at school, bugs and small creatures), each with easy, medium and hard tiers of at least six words. Static and hand-picked for a family with children under thirteen: concrete, drawable, nothing frightening or grown-up. No model writes words.

## Lobby

`createRoom` refuses more than nine invitees (400 "Up to 10 players."); `inviteTo` and `startGame` read the same cap from `GAMES['fake-artist'].maxPlayers`. `start` needs four joined (409 "Fake Artist needs at least four players."). Colours are dealt by seat at the start: red, blue, green, orange, purple, brown, pink, teal, black, gold.

## Moves (`POST /api/native/games/<id>`)

| Body | Does |
|---|---|
| `{ action: "stroke", points: [[x,y],…], end?: true, since? }` | Only the artist in turn, while drawing. Points are on the 0…1000 canvas (rounded, clamped; up to 300 a post, 1500 a line). Every post of a turn extends the same line, which the server numbers (turn index + 1) and inks in the player's colour; a posted `id`, `color` or `width` is ignored. `end: true` lifts the finger and ends the turn; it may come alone once the line has points. 409 off-turn or after the lift; 400 for bad points. |
| `{ action: "vote", playerId }` | While voting; anybody dealt in and still here, not yourself. Replaces your earlier vote. |
| `{ action: "guess", text }` | The caught fake only, while guessing. One guess; ends the round. |

Lobby verbs as every game. `since` (the drawing revision the phone holds) asks for the answer's picture as changes, exactly as Draw & Guess.

## Timeouts

Nothing waits on a person: reading 8 s, each turn 15–30 s (then skipped or cut), the vote 60 s (missing votes abstain), the guess 30 s (no guess = caught), the reveal 10 s, the finished room 10 min. `advance` takes one step a call and ignores a `now` that is not a finite number.

## Leaving mid-game

- **The fake leaves** (any time before the reveal): the round ends `fake-left`, each artist still in scores 1.
- **An artist leaves:** their turn in hand passes on, their later turns are skipped, their vote and any votes for them stop counting; the vote closes if everyone left has voted.
- **Fewer than three left:** the game finishes with the standings so far.
- The host role passes on as in every game.

## Wire (`toWire`)

Beside the shared fields (`id`, `game`, `difficulty`, `phase`, `hostId`, `meId`, `phaseEndsAt`, `players`, `standings`, `winnerIds`, `serverNow`): `rounds`, `laps` (2), `turnMs`, `readMs`, `voteMs`, `guessMs`, `revealMs`, `palette`, `history` (rounds already revealed: `{ number, category, word, fakeId, outcome }`), `drawing` (`{ revision, since, strokes | ops }` — the same shape as Draw & Guess's, strokes `{ id, color, width, points }`), and `current`:

- `number`, `category`, `role` (`artist` | `fake` | `watching`), `word`, `fakeId`
- `turns` (player ids in drawing order), `turn`, `artistId`, `turnStartedAt` (drawing only), `skipped` (turn indices)
- `voted` (who has voted), `myVote`, `votes`, `counts`, `accusedId`, `guess`, `outcome` (`escaped` | `guessed` | `caught` | `fake-left`), `awarded` (points by player)

Phases: `lobby` | `countdown` | `reading` | `drawing` | `voting` | `guessing` | `reveal` | `finished` | `closed`.

Players: `id`, `name`, `status`, `isHost`, `score`, `color`, `isDrawing`. Standings: `{ id, name, score, timesFake, winsAsFake }`, highest first.

### What each phone is told

- `word`: to the round's artists from the reading on; to everyone at the reveal. Never to the fake before the reveal (not even while guessing), never to a player not dealt into the round (declined, invited late).
- `fakeId`: to the fake themself; to everyone once the vote has caught them (`guessing`) or at the reveal. `role: "fake"` appears only in the fake's own wire.
- Votes: while voting, `voted` says who has voted and `myVote` is your own; `votes`, `counts`, `accusedId`, `guess`, `outcome` and `awarded` are null until the reveal (`accusedId` from the guess).

`fake-artist.test.ts` builds the wire for every player in every phase and searches the JSON for the word and the fake's id; `rooms.server.test.ts` does the same through the registry for six players.

### Why the picture is sent as changes

As Draw & Guess: a line streams in as the finger moves (posts every ~200 ms), and a whole picture every frame would be ~16 lines × up to 1500 points to every phone. The stream keeps each viewer's revision and sends only the stroke ops after it; an old cursor, or a new round (fresh revision), gets the whole picture.

## Not built

- A web table: the game is played in the iPhone app only.
- A "your turn to draw" push: the invite push exists, a turn push would want the app to suppress a banner for the room on screen.
- Undo, erasing or colour choice: one line each, in your colour, is the game.
- A question-master role who picks the word: the server deals it, so everyone plays.
