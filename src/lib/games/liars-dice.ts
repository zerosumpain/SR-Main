// Liar's Dice (Perudo-style) — the rules, as pure functions over a room.
//
// Same shape as Boggle (`boggle.ts`): every function takes `now` (epoch ms)
// and, where it rolls, a `rng`, so a whole game plays in a test without a
// clock. The live registry owns timers and fan-out; nothing here knows about
// either.
//
// The first turn-based, hidden-information game. Everyone rolls their dice
// under a cup; a phone sees its OWN dice and everyone else's COUNT only. In
// seat order each player raises the standing bid ("four 3s") or calls "liar".
// A call reveals every cup: if the table holds at least the bid, the caller
// loses a die, otherwise the bidder does. Lose your last die and you are out;
// the last player with dice wins.
//
// Wild ones (Perudo): on medium and hard a 1 counts as every face, and nobody
// may bid on ones — kept simple on purpose. On easy a 1 is just a 1, and may
// be bid like any face.
//
// The turn clock: a player who lets it run out has a move made for them (see
// `autoMove`), marked `auto` on the wire so every phone can say "timed out".
//
// The lobby (join / decline / leave / start / again) behaves as Boggle's does,
// except that start refuses a table of one: there is no solo Liar's Dice.

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from "./tap-duel";

export {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
};
export type { Difficulty, PlayerStatus, Rng };

export type Phase =
  "lobby" | "countdown" | "bidding" | "reveal" | "finished" | "closed";

export const DICE_COUNTS = [3, 5] as const;
export type DiceCount = (typeof DICE_COUNTS)[number];
export const DEFAULT_DICE: DiceCount = 5;
export const FACES = 6;

/** How long a turn lasts before the server moves for you. */
export const TURN_MS: Record<Difficulty, number> = {
  easy: 45_000,
  medium: 45_000,
  hard: 30_000,
};
/** How long every cup stays lifted after a call. */
export const REVEAL_MS = 6_000;

export function isDiceCount(v: unknown): v is DiceCount {
  return (
    typeof v === "number" && (DICE_COUNTS as readonly number[]).includes(v)
  );
}

/** Whether ones count as every face: medium and hard (Perudo), not easy. */
export function wildOnes(difficulty: Difficulty): boolean {
  return difficulty !== "easy";
}

/** The rule in a sentence, sent on the wire so the phone never has to know it. */
export function ruleLine(difficulty: Difficulty): string {
  return wildOnes(difficulty)
    ? "Ones are wild: they count as any face, and nobody bids on ones."
    : "Ones are not wild: a 1 is just a 1.";
}

// ---- The room ------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Sat at the table when play started: the ones standings are about. */
  seated: boolean;
  /** Dice this player still has. */
  count: number;
  /** This round's roll, face values 1–6; empty once out. Never another phone's to see. */
  dice: number[];
  /** The round they went out in (lost their last die, or left); null while in. */
  outRound: number | null;
}

export interface Bid {
  playerId: string;
  quantity: number;
  face: number;
  /** The turn clock ran out and the server bid for them. */
  auto: boolean;
  at: number;
}

export interface Reveal {
  /** The bid that was called. */
  bid: Bid;
  challengerId: string;
  /** The challenger's clock ran out and the server called for them. */
  auto: boolean;
  /** Dice showing the bid's face (plus ones, when wild). */
  count: number;
  loserId: string;
  /** The loser lost their last die with this call. */
  eliminated: boolean;
  /** Every cup at the call, in seat order. */
  dice: { playerId: string; dice: number[] }[];
}

export interface Room {
  id: string;
  game: "liars-dice";
  difficulty: Difficulty;
  /** Dice each player starts with. */
  dicePerPlayer: DiceCount;
  hostId: string;
  phase: Phase;
  players: Player[];
  /** 1-based; 0 before the first roll. */
  round: number;
  /** Who opened this round. */
  starterId: string | null;
  /** Whose turn it is while bidding; null otherwise. */
  turnId: string | null;
  /** This round's bids, oldest first; the last is the standing bid. */
  bids: Bid[];
  /** The last call, shown until the next roll (and at the finish). */
  reveal: Reveal | null;
  /** Seated players in the order they went out, first out first. */
  outOrder: string[];
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, turn clock, reveal end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return {
    id,
    name,
    status,
    seated: false,
    count: 0,
    dice: [],
    outRound: null,
  };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === "joined");
}

/** Players still in the game: seated, not gone, with dice. Seat order. */
export function alive(room: Room): Player[] {
  return room.players.filter(
    (p) => p.seated && p.status === "joined" && p.count > 0,
  );
}

/** Dice in play across the table. */
export function totalDice(room: Room): number {
  return alive(room).reduce((n, p) => n + p.count, 0);
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, "You are not in this game.");
  return p;
}

/** The table's choices from a create request; anything missing or unknown is the default. */
export function tableOptions(options: Record<string, unknown> | undefined): {
  dicePerPlayer: DiceCount;
} {
  const o = options ?? {};
  return { dicePerPlayer: isDiceCount(o.dice) ? o.dice : DEFAULT_DICE };
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter(
    (p, i, all) =>
      p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i,
  );
  if (invited.length > MAX_PLAYERS - 1)
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  return {
    id: input.id,
    game: "liars-dice",
    difficulty: input.difficulty,
    ...tableOptions(input.options),
    hostId: input.host.id,
    phase: "lobby",
    players: [
      player(input.host.id, input.host.name, "joined"),
      ...invited.map((p) => player(p.id, p.name, "invited")),
    ],
    round: 0,
    starterId: null,
    turnId: null,
    bids: [],
    reveal: null,
    outOrder: [],
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line: "5 dice each · ones wild". */
export function about(room: Room): string {
  return `${room.dicePerPlayer} dice each · ${wildOnes(room.difficulty) ? "ones wild" : "no wilds"}`;
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === "joined") return;
  if (room.phase !== "lobby")
    throw new GameError(409, "That game has already started.");
  p.status = "joined";
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "invited") return;
  p.status = "declined";
  room.updatedAt = now;
}

/** The next player still in after `fromId`, in seat order (wrapping); null if nobody is. */
function nextAlive(room: Room, fromId: string | null): Player | null {
  const seats = room.players;
  const at = fromId === null ? -1 : seats.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= seats.length; k++) {
    const p = seats[(at + k + seats.length) % seats.length];
    if (p.seated && p.status === "joined" && p.count > 0) return p;
  }
  return null;
}

/** `id` if they are still in, else the next player who is. */
function aliveFrom(room: Room, id: string | null): Player | null {
  const p = id === null ? null : room.players.find((x) => x.id === id);
  if (p && p.seated && p.status === "joined" && p.count > 0) return p;
  return nextAlive(room, id);
}

function markOut(room: Room, p: Player): void {
  if (!p.seated || room.outOrder.includes(p.id)) return;
  p.outRound = room.round;
  room.outOrder.push(p.id);
}

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host role
 * to the next player, and the last one out closes the room. Mid-game, the
 * leaver's dice leave play and they are out; a turn that was theirs passes on,
 * and a table left with one player is won by them. Bids already made stand —
 * one of the leaver's can still be called, and if it is wrong nobody loses a die.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== "joined") return;
  const wasIn = p.seated && p.count > 0;
  p.status = "left";
  room.updatedAt = now;
  if (room.phase === "lobby" && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = rest[0].id;
  if (!wasIn || (room.phase !== "bidding" && room.phase !== "reveal")) return;

  p.dice = [];
  p.count = 0;
  markOut(room, p);
  if (alive(room).length <= 1) {
    finish(room, now);
    return;
  }
  if (room.phase === "bidding" && room.turnId === playerId) {
    room.turnId = nextAlive(room, playerId)?.id ?? null;
    room.phaseEndsAt = now + TURN_MS[room.difficulty];
  }
}

function close(room: Room, now: number): void {
  room.phase = "closed";
  room.turnId = null;
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start.");
  if (room.phase !== "lobby")
    throw new GameError(409, "That game has already started.");
  if (joined(room).length < 2)
    throw new GameError(409, "Liar's Dice needs at least two players.");
  for (const p of room.players)
    if (p.status === "invited") p.status = "declined";
  room.phase = "countdown";
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same table settings — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId)
    throw new GameError(403, "Only the host can start another.");
  if (room.phase !== "finished")
    throw new GameError(409, "This game is still going.");
  for (const p of room.players) {
    p.status = p.status === "joined" ? "joined" : "invited";
    p.seated = false;
    p.count = 0;
    p.dice = [];
    p.outRound = null;
  }
  room.phase = "lobby";
  room.round = 0;
  room.starterId = null;
  room.turnId = null;
  room.bids = [];
  room.reveal = null;
  room.outOrder = [];
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Dice and bids -------------------------------------------------------

/** `n` dice, each 1–6. */
export function rollDice(n: number, rng: Rng): number[] {
  return Array.from(
    { length: n },
    () => 1 + Math.min(FACES - 1, Math.floor(rng() * FACES)),
  );
}

/** Dice on the table that count towards `face`: that face, and ones when wild. */
export function countFace(
  cups: readonly (readonly number[])[],
  face: number,
  wild: boolean,
): number {
  let n = 0;
  for (const cup of cups)
    for (const d of cup) if (d === face || (wild && d === 1)) n++;
  return n;
}

/** The lowest face that may be bid: 2 when ones are wild, else 1. */
export function minFace(wild: boolean): number {
  return wild ? 2 : 1;
}

/**
 * Why a bid is not allowed, or null if it is. Strictly higher than the
 * standing bid: more dice (any face), or as many dice of a higher face.
 */
export function bidProblem(
  bid: { quantity: unknown; face: unknown },
  standing: { quantity: number; face: number } | null,
  total: number,
  wild: boolean,
): string | null {
  const { quantity, face } = bid;
  if (
    typeof face !== "number" ||
    !Number.isInteger(face) ||
    face < 1 ||
    face > FACES
  )
    return "Pick a face from 1 to 6.";
  if (wild && face === 1) return "Ones are wild — bid on 2 to 6.";
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1
  )
    return "Bid at least one die.";
  if (quantity > total) return `There are only ${total} dice in play.`;
  if (
    standing &&
    !(
      quantity > standing.quantity ||
      (quantity === standing.quantity && face > standing.face)
    )
  ) {
    return "Bid more dice, or the same number of a higher face.";
  }
  return null;
}

function standing(room: Room): Bid | null {
  return room.bids.length ? room.bids[room.bids.length - 1] : null;
}

/** Roll every cup still in play and hand the first turn to `starterId` (or the next player in). */
function deal(
  room: Room,
  starterId: string | null,
  now: number,
  rng: Rng,
): void {
  room.round += 1;
  for (const p of room.players) p.dice = [];
  for (const p of alive(room)) p.dice = rollDice(p.count, rng);
  const first = aliveFrom(room, starterId);
  room.phase = "bidding";
  room.starterId = first?.id ?? null;
  room.turnId = first?.id ?? null;
  room.bids = [];
  room.reveal = null;
  room.phaseEndsAt = now + TURN_MS[room.difficulty];
  room.updatedAt = now;
}

function assertTurn(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (p.status !== "joined" || !p.seated)
    throw new GameError(403, "You are not playing this game.");
  if (room.phase !== "bidding") {
    throw new GameError(
      409,
      room.phase === "finished"
        ? "That game is over."
        : room.phase === "reveal"
          ? "The cups are up — wait for the next roll."
          : "The game has not started.",
    );
  }
  if (p.count === 0) throw new GameError(409, "You are out of dice.");
  if (room.turnId !== playerId) throw new GameError(409, "It's not your turn.");
  return p;
}

function placeBid(
  room: Room,
  p: Player,
  quantity: number,
  face: number,
  auto: boolean,
  now: number,
): void {
  room.bids.push({ playerId: p.id, quantity, face, auto, at: now });
  room.turnId = nextAlive(room, p.id)?.id ?? null;
  room.phaseEndsAt = now + TURN_MS[room.difficulty];
  room.updatedAt = now;
}

/**
 * Raise the standing bid on your turn: `{ quantity, face }`. An illegal bid is
 * refused (400) with a sentence for the player and costs nothing; off-turn is 409.
 */
export function bid(
  room: Room,
  playerId: string,
  input: { quantity: unknown; face: unknown },
  now: number,
): void {
  const p = assertTurn(room, playerId);
  const problem = bidProblem(
    input,
    standing(room),
    totalDice(room),
    wildOnes(room.difficulty),
  );
  if (problem) throw new GameError(400, problem);
  placeBid(room, p, input.quantity as number, input.face as number, false, now);
}

function callLiar(room: Room, p: Player, auto: boolean, now: number): void {
  const called = standing(room)!;
  const wild = wildOnes(room.difficulty);
  const cups = alive(room).map((x) => ({ playerId: x.id, dice: [...x.dice] }));
  const count = countFace(
    cups.map((c) => c.dice),
    called.face,
    wild,
  );
  // The bid stands if the table holds it: the caller was wrong.
  const loserId = count >= called.quantity ? p.id : called.playerId;
  const loser = room.players.find((x) => x.id === loserId)!;
  let eliminated = false;
  // A bidder who has since left has nothing left to lose.
  if (loser.status === "joined" && loser.count > 0) {
    loser.count -= 1;
    if (loser.count === 0) {
      eliminated = true;
      markOut(room, loser);
    }
  }
  room.reveal = {
    bid: called,
    challengerId: p.id,
    auto,
    count,
    loserId,
    eliminated,
    dice: cups,
  };
  room.phase = "reveal";
  room.turnId = null;
  room.phaseEndsAt = now + REVEAL_MS;
  room.updatedAt = now;
}

/** Call the standing bid a lie, on your turn: every cup is lifted. */
export function liar(room: Room, playerId: string, now: number): void {
  const p = assertTurn(room, playerId);
  if (!standing(room))
    throw new GameError(409, "Nobody has bid yet — open the bidding.");
  callLiar(room, p, false, now);
}

/**
 * What the server plays when a turn clock runs out. Opening: one of your own
 * most common face (never ones; ties go to the higher face). Otherwise the
 * smallest raise — one more of the same face — or, when that would be more
 * dice than the table holds, a call.
 */
export function autoMove(
  room: Room,
): { kind: "bid"; quantity: number; face: number } | { kind: "liar" } {
  const me = room.players.find((p) => p.id === room.turnId);
  const top = standing(room);
  if (!top) {
    let face = FACES;
    let best = -1;
    for (let f = FACES; f >= 2; f--) {
      const n = (me?.dice ?? []).filter((d) => d === f).length;
      if (n > best) {
        best = n;
        face = f;
      }
    }
    return { kind: "bid", quantity: 1, face };
  }
  if (top.quantity + 1 > totalDice(room)) return { kind: "liar" };
  return { kind: "bid", quantity: top.quantity + 1, face: top.face };
}

function finish(room: Room, now: number): void {
  room.phase = "finished";
  room.turnId = null;
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it.
 * Returns whether anything changed.
 *
 * Unlike the timed games, every deadline after a step is set from `now`, not
 * from the deadline that fired — so one call takes ONE step of play (a timed-
 * out turn, a reveal ending) and the next player gets their full turn. A stale
 * or far-future `now` cannot auto-play a whole game in one call.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 3; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case "lobby":
      case "finished":
        close(room, due);
        break;
      case "countdown":
        for (const p of room.players) {
          p.seated = p.status === "joined";
          p.count = p.seated ? room.dicePerPlayer : 0;
          p.outRound = null;
        }
        room.outOrder = [];
        room.startedAt = now;
        // First round: the host opens.
        deal(room, room.hostId, now, rng);
        // Somebody left during the countdown and one is left: they win it.
        if (alive(room).length <= 1) finish(room, now);
        break;
      case "bidding": {
        const p = room.players.find((x) => x.id === room.turnId);
        if (!p) {
          // Nobody's turn: hand it on rather than stall.
          room.turnId = nextAlive(room, null)?.id ?? null;
          room.phaseEndsAt = now + TURN_MS[room.difficulty];
          break;
        }
        const move = autoMove(room);
        if (move.kind === "liar") callLiar(room, p, true, now);
        else placeBid(room, p, move.quantity, move.face, true, now);
        break;
      }
      case "reveal": {
        if (alive(room).length <= 1) {
          finish(room, now);
          break;
        }
        // The loser opens the next round; if they are out, the next player in.
        deal(room, room.reveal?.loserId ?? null, now, rng);
        break;
      }
    }
    // Every step above set its next deadline from `now`: nothing more is due.
    if (room.phase !== "closed") break;
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === "closed" || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  /** 1 for the winner, 2 for the last out, and so on. */
  place: number;
  /** Dice left at the end: the winner's, else 0. */
  dice: number;
  /** The round they went out in; null for the winner. */
  outRound: number | null;
  /** They left rather than lost their dice. */
  left: boolean;
}

/** The last player in first, then everyone else by how long they lasted. */
export function standings(room: Room): Standing[] {
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const order = [
    ...alive(room),
    ...[...room.outOrder].reverse().map((id) => byId.get(id)!),
  ];
  return order.map((p, i) => ({
    id: p.id,
    name: p.name,
    place: i + 1,
    dice: p.status === "joined" ? p.count : 0,
    outRound: p.outRound,
    left: p.status === "left",
  }));
}

/** The one player with dice left; nobody if the table emptied. */
export function winners(room: Room): string[] {
  const left = alive(room);
  return left.length === 1 ? [left[0].id] : [];
}

/**
 * The room as one player's phone sees it. My own dice always; everyone else's
 * as a count only — the cups are lifted in `reveal` after a call, and every
 * player's last roll shows once the game is finished.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === "finished";
  const wild = wildOnes(room.difficulty);
  const top = standing(room);
  const wireBid = (b: Bid) => ({
    playerId: b.playerId,
    quantity: b.quantity,
    face: b.face,
    auto: b.auto,
  });
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    dicePerPlayer: room.dicePerPlayer,
    wildOnes: wild,
    rule: ruleLine(room.difficulty),
    minFace: minFace(wild),
    turnMs: TURN_MS[room.difficulty],
    round: room.round,
    starterId: room.starterId,
    turnId: room.turnId,
    totalDice: totalDice(room),
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    bid: top ? wireBid(top) : null,
    bids: room.bids.map(wireBid),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seated: p.seated,
      diceCount: p.count,
      out: p.seated && room.outOrder.includes(p.id),
      dice: p.id === meId || finished ? [...p.dice] : null,
    })),
    reveal: room.reveal
      ? {
          bid: wireBid(room.reveal.bid),
          challengerId: room.reveal.challengerId,
          auto: room.reveal.auto,
          count: room.reveal.count,
          loserId: room.reveal.loserId,
          eliminated: room.reveal.eliminated,
          dice: room.reveal.dice.map((c) => ({
            playerId: c.playerId,
            dice: [...c.dice],
          })),
        }
      : null,
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
