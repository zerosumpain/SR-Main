# Family games: durable rooms

Status: designed 2026-10-22, not built. Branches: SR-Main `feat/games-durable-20261022` (`~/sr-main-games-durable`), SR-AppleApp `feat/games-durable-20261022` (`~/sr-appleapp-games-durable`). First adopter: Homestead (`2026-10-22-family-games-homestead.md`, built in parallel on `feat/games-homestead-20261022`).

## Why

Rooms live in memory in `$lib/games/rooms.server.ts`, so a deploy ends every game in play. That is fine for a three-minute Tap Duel and wrong for a board game that takes an hour live, or days when the family plays a move each in the evening. This adds an **opt-in** durable mode: a game declares `durable` in its `GameRules`, and its rooms are written to Postgres after every accepted change and read back after a restart. A game that does not declare it behaves exactly as today. The in-memory map stays the authority while the process is up; the table is what survives a restart.

It also adds a turn **pace** per room (`live` or `async`), a "your move" push for async rooms, and lists a player's open durable games in the lobby so the app can resume one days later.

## Data model

One new table, `game_rooms`, in `src/lib/db/schema.ts` right after `gameResults`:

```ts
export const gameRooms = pgTable(
  'game_rooms',
  {
    /** The room id the phones already hold: 'g_' + 12 hex. */
    id: text('id').primaryKey(),
    /** A `GameId` from `$lib/games/catalogue`. */
    game: text('game').notNull(),
    /** The game's `durable.schema` when `state` was written; a mismatch goes through `durable.revive`. */
    stateSchema: integer('state_schema').notNull().default(1),
    /** 'live' | 'async'. */
    pace: text('pace').notNull().default('live'),
    /** The room's `phase`, copied out for the lobby query and the sweep. */
    phase: text('phase').notNull(),
    /** Hashed player id (`playerId(email)`), never an email. */
    hostId: text('host_id').notNull(),
    /** Every id in `room.players`, any status (hashed). The lobby and erasure look up by containment. */
    playerIds: text('player_ids').array().notNull(),
    /** The whole room as the rules module holds it (JSON-safe by contract). Hidden information included: never sent anywhere but `toWire`. */
    state: jsonb('state').notNull(),
    /** The registry's own bookkeeping for the room (see "meta" below). */
    meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
    /** Monotonic write counter; every write is compare-and-set on it. */
    version: integer('version').notNull(),
    /** `rules.deadline(room)` as a time, null when the room waits on people. The sweep's index. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the room reaches `finished`; cleared by "Play again". Retention counts from it. */
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set when the room reaches `closed`. A closed row is never rehydrated. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    // GIN: "which rooms contain this player" is containment over the array.
    index('game_rooms_player_ids_idx').using('gin', t.playerIds),
    index('game_rooms_due_idx').on(t.dueAt).where(sql`${t.closedAt} is null`),
    index('game_rooms_updated_idx').on(t.updatedAt),
  ],
);
export type GameRoomRow = typeof gameRooms.$inferSelect;
```

No serial: the key is the room id, so there is **no sequence to grant** (the `game_results_id_seq` trap does not apply). No email anywhere: players are the games' keyed hash (`players.server.ts` `playerId`), exactly like `game_results`. Names appear inside `state` as they do on the wire today.

`meta` holds what `Live` keeps beside the room and must outlive a restart:

```json
{
  "optionKeys": ["pace", "deadlineHours", "island"],
  "round": 2,
  "recorded": true,
  "sawInvite": ["p_3f2a…"],
  "pushed": ["p_3f2a…"],
  "turnPushed": { "key": "41:p_9c1d…", "ids": ["p_9c1d…"] },
  "finishPushed": false
}
```

`records` (who set a family high score) is not kept: it is re-sent only while the room is still `finished` in the same process; after a restart the board itself still has the score.

### Migration and grants

- **Production**: CI's `drizzle-kit push` from master creates the table. It is a creates-only diff. Before merging, check `drizzle.config.ts` `tablesFilter` still covers every undeclared table prod holds (`reference_drizzle_push_rename_prompt`): a create paired with a drop prompts and kills the release.
- **Grant**: `scripts/migrations/2026-10-22-game-rooms-runtime-grant.sql`, applied by hand as `app` after the deploy that creates the table (`docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling < file`):

```sql
-- Durable game rooms for Main's restricted runtime role. `drizzle-kit push`
-- creates `game_rooms` as the owner and a new table gets NO grant: without
-- this every durable room's write fails and every lobby read 500s (the
-- game_results trap, 2026-10-21). Text primary key: no sequence to grant.
-- DELETE because the retention sweep and account erasure run in-process.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sr_main_runtime') THEN
    IF to_regclass('public.game_rooms') IS NOT NULL THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_rooms TO sr_main_runtime;
    END IF;
  END IF;
END $$;
```

- **SR-Infra (not edited from here; needs its own PR)**: add `"game_rooms"` to the `main` list in `registry/runtime-tables.json`, alphabetically right after `"game_results"`.
- **Dev DB (homeserv :5433)**: never `drizzle-kit push` from a worktree (`reference_worktree_drizzle_push_drops_dev_columns`). Apply idempotent SQL instead:

```sql
CREATE TABLE IF NOT EXISTS game_rooms (
  id text PRIMARY KEY,
  game text NOT NULL,
  state_schema integer NOT NULL DEFAULT 1,
  pace text NOT NULL DEFAULT 'live',
  phase text NOT NULL,
  host_id text NOT NULL,
  player_ids text[] NOT NULL,
  state jsonb NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS game_rooms_player_ids_idx ON game_rooms USING gin (player_ids);
CREATE INDEX IF NOT EXISTS game_rooms_due_idx ON game_rooms (due_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS game_rooms_updated_idx ON game_rooms (updated_at);
```

- **Erasure**: `src/lib/people/erase.ts`, beside the `gameResults` delete: `tx.delete(gameRooms).where(sql\`${gameRooms.playerIds} && ${hashes}\`)`, then (after the transaction) `dropRooms(ids)` from `rooms.server` so a room loaded in memory is closed and its phones told `gone`. Erasing one person ends that game for the others too; that is accepted.

## GameRules additions (`catalogue.ts`)

All optional; a game that sets none is unchanged.

```ts
export type Pace = 'live' | 'async';

export interface RoomBase {
  // …existing fields…
  /** Set by a game that supports pace (from `options.pace`); absent = 'live'. */
  pace?: Pace;
}

export interface GameRules {
  // …existing members…
  /**
   * Rooms of this game are written to `game_rooms` and survive a restart.
   * `schema` is bumped when the room's stored shape changes; a row written
   * under an older schema is passed to `revive` (null = cannot: the room is
   * closed and logged). The room MUST be JSON-safe: plain objects, arrays,
   * strings, finite numbers, booleans, null — no Map, Set, Date, undefined-
   * meaning-something, functions, or class instances. Each durable game has
   * a test that `JSON.parse(JSON.stringify(room))` deep-equals the room at
   * every phase of a played game.
   */
  durable?: { schema: number; revive?(state: Record<string, unknown>, fromSchema: number): RoomBase | null };
  /** The paces a host may pick; absent = ['live']. The lobby sends it so the app can offer "Over days". */
  paces?: readonly Pace[];
  /**
   * Who the room is waiting on right now and a key that changes whenever a
   * new decision starts (turn number + step + who). Null when nobody (lobby,
   * countdown, finished). Drives the "your move" push and the lobby's
   * `myTurn`. `line` is the push body's first sentence ("Sam rolled a 9.").
   */
  waitingOn?(room: RoomBase): { ids: string[]; key: string; line?: string } | null;
  /**
   * A live-pace room read back after a restart: the game restarts the
   * running decision's timer from `now` (a deploy is a pause, never a
   * timeout). `pausedMs` is how long it was down. Not called for async rooms,
   * whose deadlines are hours and are honoured as written.
   */
  resume?(room: RoomBase, now: number, pausedMs: number): void;
}
```

The builder of a durable game on another branch can export `durable`, `paces`, `waitingOn` and `resume` from its module before this interface lands: `GAMES` spreads the module (`...homestead`), and TypeScript does not excess-check spread members, so it compiles alone and is typed once merged.

## Pace

`options.pace`: `'live'` (default) or `'async'`, accepted only when it is in `rules.paces`; anything else is `'live'`. With async, `options.deadlineHours` is `12 | 24 | 48` (default 24; anything else is 24). The game owns its timers: in async it sets each decision's `phaseEndsAt` to `now + deadlineHours`, and auto-moves on expiry exactly as a live timeout does. The async lobby is held open for `deadlineHours` (a live lobby keeps `LOBBY_MS`); an async finished room stays `finished` for 72 h (live keeps `FINISHED_MS`), so somebody who comes back two days later sees the result.

`api.server.ts` `startGame` forwards `pace`, `deadlineHours`, `island` in the options object (append-only; `island` is Homestead's board size, kept apart from Quiz Night's `board`).

Expiry is evaluated three ways, all through the existing `settle`/`advance` path:

1. The room's `setTimeout` while it is in memory (Node handles delays up to 24.8 days; 48 h is fine).
2. Lazily: any access (`roomFor`, `act`, `subscribe`, the lobby) first rehydrates, then `settle` runs `advance(now)`, which catches up an overdue deadline.
3. The sweep (below), so an async game whose players are all away still moves on its own.

`advance` is one step per call with each next deadline set from `now`, so a room that was down for three days takes one auto-move on rehydration, not a cascade; the next deadline is a fresh `deadlineHours` from then.

## Registry changes (`rooms.server.ts`)

New fields on `Live` (in memory): `durable: boolean`, `version: number` (bumped on every change), `savedVersion: number` (last version the table confirmed), `writing: Promise<void> | null`, `dirty: boolean`, `subscribers: Map<playerId, count>`, `turnPushed`, `finishPushed`. The store is injectable like the recorder: `_setRoomStore(store | null)`; tests use an in-memory store, and with no `DATABASE_URL` the store is a no-op that logs once.

```ts
interface RoomStore {
  insert(row: StoredRoom): Promise<boolean>;                         // false = id already exists
  save(row: StoredRoom, expected: number): Promise<'ok' | 'stale' | 'missing'>;
  load(id: string): Promise<StoredRoom | null>;                      // null for missing or closed
  openFor(playerId: string, limit: number): Promise<string[]>;       // closed_at is null, player_ids @> [id]
  countOpenByHost(hostId: string): Promise<number>;
  due(before: Date, limit: number): Promise<string[]>;               // closed_at is null and due_at <= before
  purge(now: Date): Promise<string[]>;                               // retention delete, returns the ids removed
}
```

### Write path (after every accepted change)

`settle(live, changed)` is where every mutation already ends. When `live.durable && changed`: `live.version += 1; persist(live)`. `markInvitesPushed`, the invite read in `invitesFor` (`sawInvite`) and the push bookkeeping also call `persist` (they bump the version too: the version counts writes, not moves).

`persist(live)` serialises writes per room and coalesces: if a write is in flight it sets `dirty` and returns; the loop writes the latest snapshot when the current one lands. One write is one statement, so state, meta, phase and version change together:

```sql
UPDATE game_rooms
   SET state = $state, meta = $meta, phase = $phase, player_ids = $ids, due_at = $due,
       version = $v, updated_at = now(), finished_at = $finishedAt, closed_at = $closedAt
 WHERE id = $id AND version = $expected        -- expected = live.savedVersion
```

The first write of a room is `insert` (from `createGame`, version 1). Results:

- `ok`: `savedVersion = v`; loop again if `dirty`.
- `stale` (the row's version is not ours: another process wrote it — only possible if two web processes ever overlap): log `[games] <id>: lost a write race`, reload the row, replace `live.room`, set both versions to the row's, `emit`. Local unsaved changes are dropped; the next move from a phone is judged against the reloaded room.
- `missing` (erased or purged): close the room in memory and `emit('gone')`.
- A thrown error (database down): log once per room per outage, keep `dirty`, retry after 2 s, 5 s, 15 s, then every 60 s. **The game keeps going in memory**; only a restart during the outage loses the unsaved moves.

`finished_at` = the room's `updatedAt` when `phase === 'finished'` and null otherwise ("Play again" clears it); `closed_at` = now when `phase === 'closed'`.

**Acknowledged means saved.** For a durable room, `api.server.ts` `startGame`, `roomAct` and the invite branch await `flush(id, 3000)` before answering: a promise that resolves when `savedVersion >= ` the version at the call, or after 3 s (then the answer goes out anyway and the write keeps retrying). `act` itself stays synchronous, so every existing test of every in-memory game is untouched.

### Rehydration (lazy)

`ensureRoom(id): Promise<void>` — called by `api.server.ts` before `roomFor`, `act`, `inviteTo` and `subscribe` (each of those stays synchronous and still 404s "That game has finished." for an id that is neither in memory nor in the table):

1. In memory already → return. An in-flight load for the same id → await it (one promise per id in a `loading` map).
2. `store.load(id)`; null (missing or closed) → return.
3. `rules = GAMES[row.game]`; not a known or not a durable game → log, return.
4. `room = row.stateSchema === rules.durable.schema ? row.state : rules.durable.revive?.(row.state, row.stateSchema) ?? null`; null → log, write `closed_at`, return.
5. Build the `Live` from `meta` (`sawInvite`, `pushed` as Sets; `round`, `recorded`, `optionKeys`), `version = savedVersion = row.version`.
6. If `room.pace !== 'async'` and the room is not `lobby`/`finished`, call `rules.resume?.(room, now, now − row.updatedAt)`; then `settle(live, resumed)`: `advance` catches up an overdue async deadline, the timer is re-armed, and anything that moved is written.

`hydrateFor(playerId)` — called by `lobbyFor` before `invitesFor`/`roomsFor`: `store.openFor(playerId, 20)` then `ensureRoom` each. Memoised per player for 60 s (the app polls every 5 s; the first poll after a restart always queries). After it, `invitesFor` and `roomsFor` read memory exactly as now, so an async invite survives a deploy.

### Limits

`canCreate` keeps today's in-memory caps for non-durable games. For a durable game `startGame` also awaits `canCreateDurable(hostId)`: at most 5 open durable rooms per host (`countOpenByHost`) — "Finish one of your games first." — and the in-memory cap of 50 counts only rooms in memory, so evicted async rooms do not crowd out a Tap Duel.

### Eviction

The sweep drops from memory a durable room with no subscribers, `savedVersion === version`, untouched for 6 h, and no deadline in the next hour (timer cleared, no `gone` emitted: the row remains and the next access reloads it).

### Sweep

`startGameRoomSweep()` from `hooks.server.ts` under `runsService('background')` (the web role; the builder and WhatsApp roles run none), every 5 min plus once 30 s after boot:

1. `store.due(now + 60 s, 50)` → `ensureRoom` each (rehydration settles it: the auto-move happens, the push goes).
2. Eviction (above).
3. `store.purge(now)` then `dropRooms(removed)`.

### Retention (`purge`)

```sql
DELETE FROM game_rooms
 WHERE (finished_at IS NOT NULL AND finished_at < now() - interval '7 days')
    OR (finished_at IS NULL AND closed_at IS NOT NULL AND closed_at < now() - interval '1 day')
    OR (updated_at < now() - interval '30 days')
RETURNING id
```

Finished: 7 days after finishing. Abandoned: 30 days with no write (a lobby or game nobody returned to; an async game auto-moves at most for as long as its own "away" rule allows, see Homestead). A room that closed without finishing (lobby expired, host cancelled) is kept a day. The result itself lives on in `game_results`, which is unaffected.

## "Your move" push

Async rooms only (a live room's players are looking at it). After every `settle` of an async durable room the registry calls `rules.waitingOn(room)`:

- New `key` → reset `turnPushed = { key, ids: [] }`.
- For each waiting id not in `turnPushed.ids` and with **no open stream on this room** (`live.subscribers`), push, then add the ids the push reached (persisted in `meta`, so a restart never rings twice for one decision).

New function in `invite-push.server.ts` (append-only; reuses `gamePlayers` for id → email and `pushToEmails`):

```ts
export function turnMessage(t: { roomId: string; game: GameId; line?: string; dueAt: number | null }, now = Date.now()): PushMessage
// title: `Your move in ${TITLES[game]}`
// body:  `${line ? line + ' ' : ''}${hoursLeft} h left.`  ("Sam rolled a 9. 23 h left.")
// category 'game', threadId 'game', level 'active' (not time-sensitive: it has hours),
// collapseId `game-${roomId}`, userInfo { roomId, game, category: 'game', kind: 'turn' },
// ttlSeconds: until dueAt (min 60)
export async function pushTurn(roomId: string, ids: string[], push = pushToEmails): Promise<string[]>
```

When an async room reaches `finished`, everyone joined and not streaming it gets one `"${TITLES[game]} is over"` / `"${winner} won."` push (`kind: 'finished'`, `meta.finishPushed`). Never throws; a failure is logged and the lobby poll still shows `myTurn`.

App: `willPresent` returns `[]` (and refreshes the room) for a `game` push whose `roomId` is the room on screen; tapping a turn push opens the room through the existing `category == "game"` path (`pending.gameRoom`).

## Lobby listing

`GET /api/native/games` (and the web lobby, same `lobbyFor`) — no new route, so no `public-routes.txt` or access-catalogue copies. Additions, all optional for older apps:

```json
{
  "rooms": [
    {
      "id": "g_4be1c2d09a7f", "game": "homestead", "phase": "playing", "hostName": "John",
      "durable": true, "pace": "async", "myTurn": true,
      "waitingFor": ["Rory"], "dueAt": 1761300000000, "updatedAt": 1761213600000
    }
  ],
  "paces": { "homestead": ["live", "async"] }
}
```

`roomsFor` fills the new fields from memory (after `hydrateFor`): `myTurn` = `waitingOn(room)?.ids` includes me; `waitingFor` = their names; `dueAt` = `rules.deadline(room)`. Non-durable rooms send `durable: false, pace: "live", myTurn: false` and nulls. `paces` lists only games whose `paces` include more than `'live'`.

App (`GameModels.swift`): `GameRoomSummary` decodes the new fields with defaults (`durable` false, `pace` "live", `myTurn` false, the rest nil); `GamesLobby` decodes `paces` (default empty). `GamesScreen` shows the resume rows as "Your games", `myTurn` first then by `updatedAt`, each with "Your move · 21 h left" or "Waiting for Rory". The new-game sheet offers a Pace picker ("Play now" / "Over days", then 12/24/48 h) only for a game listed in `paces`. Demo fixtures add one async Homestead room with `myTurn: true` and one waiting.

## Wire additions (every durable room)

`toWire` output gains, added by the registry's `wire()` (not by each game): `durable: true`, `pace`, `version` (the room's write counter; the app may ignore it). Non-durable rooms are unchanged.

## Failure modes

| What | What happens |
|---|---|
| Database down at a move | Move accepted in memory, write retried with backoff, answer sent after the 3 s flush wait. A restart during the outage loses unsaved moves (logged with the room id). |
| Database down at a lobby poll | `hydrateFor` fails → logged, the lobby answers from memory. |
| Database down at create of a durable game | `canCreateDurable` throws → 503 "Games can't be saved right now. Try again shortly." (refused, rather than an unsaveable durable room). |
| Restart mid-live-game | Phones see the stream drop and reconnect (existing behaviour); `subscribe` → `ensureRoom` → `resume` restarts the running timer. |
| Restart mid-async-game | Nothing visible; the next access or the sweep reloads it. |
| Two processes write one room | Compare-and-set: the loser reloads. Not expected (one web process). |
| A game's stored shape changes | Bump `durable.schema` and write `revive`; without `revive` old rows close cleanly ("That game has finished."). |
| `AUTH_SECRET` rotated | Player ids change, so rooms no longer match their players and orphan; they age out in 30 days. Same as `game_results`. |
| Row erased/purged while loaded | Next write returns `missing` → room closed, phones told `gone`. |
| State not JSON-safe | Caught by the per-game round-trip test; in production a value that does not survive is a bug in that game. |
| Very large state | Homestead is ~20 KB; a write per move is fine. A durable game must keep its log bounded. |

## Tests

- `rooms.server.test.ts`: a fixture durable game (test-only rules) through an in-memory store: write after every accepted move with a monotonic version, coalescing under a slow store, `stale` reload, `missing` close, DB error keeps playing and retries, rehydrate after `_resetRooms()` (with and without `resume`), overdue async deadline auto-moves once, `hydrateFor` lists an async invite after a restart, eviction and reload, push once per `waitingOn` key and never to a streaming player.
- Every existing game's test passes unchanged; one test asserts a non-durable room never touches the store.
- `invite-push.server.test.ts`: `turnMessage` copy and ttl.
- `results` unchanged.
- App: decoding the new lobby fields with and without them; ordering of "Your games".

## Not built

- Durable mode for any existing game (Chess is the obvious next adopter; one line plus `waitingOn`/`resume`).
- A reminder push before an async deadline; per-room mute; quiet hours (pushes are `active`, so Focus holds them).
- Leases or multi-process ownership (one web process; compare-and-set only detects).
- Web (`/games/[id]`) play of durable games; the web lobby lists them and says "open in the app".
- Spectators, or rejoining a room you left.
