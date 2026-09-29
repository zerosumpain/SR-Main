import { describe, expect, it } from "vitest";
import {
  about,
  advance,
  again,
  autoMove,
  bid,
  bidProblem,
  countFace,
  createRoom,
  deadline,
  join,
  leave,
  liar,
  rollDice,
  start,
  tableOptions,
  toWire,
  COUNTDOWN_MS,
  REVEAL_MS,
  TURN_MS,
  type Difficulty,
  type Room,
} from "./liars-dice";

const T0 = 1_790_000_000_000;
const half = () => 0.5;

const SAM = { id: "p_sam", name: "Sam" };
const KIM = { id: "p_kim", name: "Kim" };

function room(
  invite = [SAM],
  difficulty: Difficulty = "medium",
  options: Record<string, unknown> = {},
): Room {
  return createRoom({
    id: "g_1",
    host: { id: "p_john", name: "John" },
    invite,
    difficulty,
    options,
    now: T0,
  });
}

/** Everyone joins, the countdown runs down, and the cups are set so the test knows them. */
function playing(r: Room, cups: Record<string, number[]>): number {
  for (const p of r.players) if (p.status === "invited") join(r, p.id, T0);
  start(r, "p_john", T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  for (const p of r.players) {
    if (cups[p.id]) {
      p.dice = [...cups[p.id]];
      p.count = cups[p.id].length;
    }
  }
  return T0 + COUNTDOWN_MS;
}

function status(fn: () => void): [number, string] {
  try {
    fn();
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
  return [0, ""];
}

describe("the table", () => {
  it("takes 3 or 5 dice each, defaulting to 5, and says what it is in the invite", () => {
    expect(tableOptions({ dice: 3 }).dicePerPlayer).toBe(3);
    expect(tableOptions({ dice: 4 }).dicePerPlayer).toBe(5);
    expect(tableOptions(undefined).dicePerPlayer).toBe(5);
    expect(about(room([SAM], "easy", { dice: 3 }))).toBe(
      "3 dice each · no wilds",
    );
    expect(about(room([SAM], "medium"))).toBe("5 dice each · ones wild");
  });

  it("rolls dice from 1 to 6", () => {
    const dice = rollDice(200, Math.random);
    expect(dice).toHaveLength(200);
    expect(dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)).toBe(
      true,
    );
    expect(rollDice(3, () => 0.999999)).toEqual([6, 6, 6]);
    expect(rollDice(3, () => 0)).toEqual([1, 1, 1]);
  });

  it("will not start a table of one", () => {
    const r = room([SAM]);
    expect(status(() => start(r, "p_john", T0))).toEqual([
      409,
      "Liar's Dice needs at least two players.",
    ]);
    join(r, "p_sam", T0);
    start(r, "p_john", T0);
    expect(r.phase).toBe("countdown");
  });

  it("gives everyone their dice and the host the first turn", () => {
    const r = room([SAM], "medium", { dice: 3 });
    join(r, "p_sam", T0);
    start(r, "p_john", T0);
    advance(r, T0 + COUNTDOWN_MS, half);
    expect(r.phase).toBe("bidding");
    expect(r.round).toBe(1);
    expect(r.turnId).toBe("p_john");
    expect(r.players.map((p) => p.dice.length)).toEqual([3, 3]);
    expect(deadline(r)).toBe(T0 + COUNTDOWN_MS + TURN_MS.medium);
  });
});

describe("bidding", () => {
  it("only goes up: more dice, or as many of a higher face", () => {
    const top = { quantity: 3, face: 4 };
    expect(bidProblem({ quantity: 4, face: 2 }, top, 10, true)).toBeNull();
    expect(bidProblem({ quantity: 3, face: 5 }, top, 10, true)).toBeNull();
    expect(bidProblem({ quantity: 3, face: 4 }, top, 10, true)).toMatch(
      /higher/,
    );
    expect(bidProblem({ quantity: 3, face: 3 }, top, 10, true)).toMatch(
      /higher/,
    );
    expect(bidProblem({ quantity: 2, face: 6 }, top, 10, true)).toMatch(
      /higher/,
    );
  });

  it("never bids more dice than are in play, nor ones when they are wild", () => {
    expect(bidProblem({ quantity: 11, face: 3 }, null, 10, true)).toBe(
      "There are only 10 dice in play.",
    );
    expect(bidProblem({ quantity: 2, face: 1 }, null, 10, true)).toMatch(
      /wild/,
    );
    expect(bidProblem({ quantity: 2, face: 1 }, null, 10, false)).toBeNull();
    expect(
      bidProblem({ quantity: 0, face: 3 }, null, 10, false),
    ).not.toBeNull();
    expect(
      bidProblem({ quantity: 2.5, face: 3 }, null, 10, false),
    ).not.toBeNull();
    expect(
      bidProblem({ quantity: "2", face: 3 }, null, 10, false),
    ).not.toBeNull();
    expect(
      bidProblem({ quantity: 2, face: 7 }, null, 10, false),
    ).not.toBeNull();
  });

  it("takes a bid on your turn only, and passes the turn on in seat order", () => {
    const r = room([SAM, KIM]);
    const t = playing(r, {});
    expect(status(() => bid(r, "p_sam", { quantity: 1, face: 3 }, t))).toEqual([
      409,
      "It's not your turn.",
    ]);
    expect(status(() => liar(r, "p_john", t))[0]).toBe(409);
    bid(r, "p_john", { quantity: 2, face: 3 }, t);
    expect(r.turnId).toBe("p_sam");
    expect(status(() => bid(r, "p_sam", { quantity: 2, face: 2 }, t))[0]).toBe(
      400,
    );
    bid(r, "p_sam", { quantity: 2, face: 5 }, t + 1);
    expect(r.turnId).toBe("p_kim");
    bid(r, "p_kim", { quantity: 3, face: 2 }, t + 2);
    expect(r.turnId).toBe("p_john");
    expect(r.bids.map((b) => [b.playerId, b.quantity, b.face])).toEqual([
      ["p_john", 2, 3],
      ["p_sam", 2, 5],
      ["p_kim", 3, 2],
    ]);
    // Every move restarts the clock for the next player.
    expect(deadline(r)).toBe(t + 2 + TURN_MS.medium);
  });
});

describe("calling liar", () => {
  it("counts ones as every face when they are wild", () => {
    const cups = [
      [1, 3, 3],
      [1, 1, 5],
    ];
    expect(countFace(cups, 3, true)).toBe(5);
    expect(countFace(cups, 3, false)).toBe(2);
    expect(countFace(cups, 1, false)).toBe(3);
  });

  it("costs the caller a die when the table holds the bid", () => {
    const r = room([SAM], "medium", { dice: 3 });
    const t = playing(r, { p_john: [1, 3, 6], p_sam: [3, 3, 2] });
    bid(r, "p_john", { quantity: 4, face: 3 }, t);
    liar(r, "p_sam", t + 1);
    expect(r.phase).toBe("reveal");
    expect(r.reveal).toMatchObject({
      count: 4,
      loserId: "p_sam",
      challengerId: "p_sam",
      auto: false,
    });
    expect(r.players.find((p) => p.id === "p_sam")!.count).toBe(2);
    expect(deadline(r)).toBe(t + 1 + REVEAL_MS);
  });

  it("costs the bidder a die when it does not, and the loser opens the next round", () => {
    const r = room([SAM], "easy", { dice: 3 });
    const t = playing(r, { p_john: [1, 3, 6], p_sam: [3, 3, 2] });
    bid(r, "p_john", { quantity: 4, face: 3 }, t);
    liar(r, "p_sam", t + 1);
    // Easy: ones are not wild, so three 3s is short of four.
    expect(r.reveal).toMatchObject({ count: 3, loserId: "p_john" });
    expect(r.players[0].count).toBe(2);
    advance(r, t + 1 + REVEAL_MS, half);
    expect(r.phase).toBe("bidding");
    expect(r.round).toBe(2);
    expect(r.turnId).toBe("p_john");
    expect(r.bids).toEqual([]);
    expect(r.reveal).toBeNull();
    expect(r.players.map((p) => p.dice.length)).toEqual([2, 3]);
  });

  it("puts a player with no dice out, and the last one in wins", () => {
    const r = room([SAM, KIM], "medium");
    const t = playing(r, { p_john: [5, 5], p_sam: [2], p_kim: [6, 6] });
    bid(r, "p_john", { quantity: 3, face: 4 }, t);
    liar(r, "p_sam", t + 1); // no 4s, no ones: John loses one
    advance(r, t + 1 + REVEAL_MS, half);
    const t2 = t + 1 + REVEAL_MS;
    expect(r.turnId).toBe("p_john");
    // Fix the new cups so nothing on the table is a 3 or a one.
    r.players[0].dice = [5];
    r.players[1].dice = [2];
    r.players[2].dice = [6, 6];
    bid(r, "p_john", { quantity: 1, face: 3 }, t2);
    bid(r, "p_sam", { quantity: 4, face: 3 }, t2 + 1);
    liar(r, "p_kim", t2 + 2); // Sam bid 4 threes and there are none
    expect(r.reveal).toMatchObject({ loserId: "p_sam", eliminated: true });
    expect(r.outOrder).toEqual(["p_sam"]);
    advance(r, t2 + 2 + REVEAL_MS, half);
    // Sam is out: the next player in opens.
    expect(r.turnId).toBe("p_kim");
    const w = toWire(r, "p_john", t2 + 3) as ReturnType<typeof toWire>;
    expect(w.players.find((p) => p.id === "p_sam")).toMatchObject({
      out: true,
      diceCount: 0,
    });

    // Kim and John play it out: John down to nothing.
    const [john, , kim] = r.players;
    john.count = 1;
    kim.count = 2;
    john.dice = [2];
    kim.dice = [2, 2];
    const t3 = t2 + 3;
    bid(r, "p_kim", { quantity: 1, face: 6 }, t3);
    liar(r, "p_john", t3 + 1); // no 6s and no ones: Kim was lying
    expect(r.reveal!.loserId).toBe("p_kim");
    advance(r, t3 + 1 + REVEAL_MS, half);
    kim.dice = [5];
    john.dice = [5];
    // Kim lost, so Kim opens.
    expect(r.turnId).toBe("p_kim");
    bid(r, "p_kim", { quantity: 2, face: 5 }, t3 + 10);
    liar(r, "p_john", t3 + 11);
    expect(r.reveal).toMatchObject({ loserId: "p_john", eliminated: true });
    advance(r, t3 + 11 + REVEAL_MS, half);
    expect(r.phase).toBe("finished");
    const done = toWire(r, "p_sam", t3 + 12);
    expect(done.winnerIds).toEqual(["p_kim"]);
    expect(done.standings!.map((s) => [s.id, s.place])).toEqual([
      ["p_kim", 1],
      ["p_john", 2],
      ["p_sam", 3],
    ]);
  });
});

describe("the turn clock", () => {
  it("opens with one of your most common face when you time out", () => {
    const r = room([SAM], "medium");
    const t = playing(r, { p_john: [1, 1, 4, 4, 6], p_sam: [2, 2, 2, 2, 2] });
    expect(autoMove(r)).toEqual({ kind: "bid", quantity: 1, face: 4 });
    advance(r, t + TURN_MS.medium, half);
    expect(r.bids).toEqual([
      expect.objectContaining({
        playerId: "p_john",
        quantity: 1,
        face: 4,
        auto: true,
      }),
    ]);
    expect(r.turnId).toBe("p_sam");
    expect(toWire(r, "p_sam", t).bid).toEqual({
      playerId: "p_john",
      quantity: 1,
      face: 4,
      auto: true,
    });
  });

  it("raises by one of the same face, or calls when that is more dice than the table holds", () => {
    const r = room([SAM], "hard", { dice: 3 });
    const t = playing(r, { p_john: [3, 3, 3], p_sam: [2, 2, 2] });
    bid(r, "p_john", { quantity: 5, face: 3 }, t);
    expect(autoMove(r)).toEqual({ kind: "bid", quantity: 6, face: 3 });
    advance(r, t + TURN_MS.hard, half);
    expect(r.bids.at(-1)).toMatchObject({
      playerId: "p_sam",
      quantity: 6,
      auto: true,
    });
    // Six dice in play: seven is impossible, so John's clock calls.
    expect(autoMove(r)).toEqual({ kind: "liar" });
    advance(r, t + 2 * TURN_MS.hard, half);
    expect(r.phase).toBe("reveal");
    expect(r.reveal).toMatchObject({
      challengerId: "p_john",
      auto: true,
      loserId: "p_sam",
    });
  });

  it("takes one step per call: a stale clock cannot play the game out", () => {
    const r = room([SAM], "medium");
    const t = playing(r, {});
    expect(advance(r, t + 10 * 60 * 60_000, half)).toBe(true);
    expect(r.bids).toHaveLength(1);
    expect(r.phase).toBe("bidding");
    expect(deadline(r)).toBe(t + 10 * 60 * 60_000 + TURN_MS.medium);
  });

  it("ignores a clock that is not a number", () => {
    const r = room([SAM], "medium");
    const t = playing(r, {});
    for (const bad of [NaN, Infinity, -Infinity])
      expect(advance(r, bad, half)).toBe(false);
    expect(r.bids).toEqual([]);
    expect(r.turnId).toBe("p_john");
    expect(deadline(r)).toBe(t + TURN_MS.medium);
  });
});

describe("leaving", () => {
  it("passes a leaver's turn on and takes their dice out of play", () => {
    const r = room([SAM, KIM], "medium", { dice: 3 });
    const t = playing(r, {});
    bid(r, "p_john", { quantity: 2, face: 4 }, t);
    leave(r, "p_sam", t + 5);
    expect(r.turnId).toBe("p_kim");
    expect(deadline(r)).toBe(t + 5 + TURN_MS.medium);
    expect(toWire(r, "p_kim", t + 5).totalDice).toBe(6);
    expect(r.outOrder).toEqual(["p_sam"]);
  });

  it("hands the win to the last player at the table", () => {
    const r = room([SAM], "medium");
    const t = playing(r, {});
    leave(r, "p_john", t + 1);
    expect(r.phase).toBe("finished");
    expect(r.hostId).toBe("p_sam");
    const w = toWire(r, "p_sam", t + 1);
    expect(w.winnerIds).toEqual(["p_sam"]);
    expect(w.standings).toEqual([
      expect.objectContaining({ id: "p_sam", place: 1, left: false }),
      expect.objectContaining({ id: "p_john", place: 2, left: true }),
    ]);
  });

  it("plays again with the same table", () => {
    const r = room([SAM], "medium", { dice: 3 });
    const t = playing(r, {});
    leave(r, "p_sam", t + 1);
    again(r, "p_john", t + 2);
    expect(r.phase).toBe("lobby");
    expect(r.dicePerPlayer).toBe(3);
    expect(r.players.map((p) => [p.status, p.count, p.dice])).toEqual([
      ["joined", 0, []],
      ["invited", 0, []],
    ]);
    expect(r.outOrder).toEqual([]);
  });
});

describe("what a phone sees", () => {
  it("shows my cup, and only a count of everyone else's", () => {
    const r = room([SAM, KIM], "medium", { dice: 3 });
    const t = playing(r, {
      p_john: [1, 2, 3],
      p_sam: [4, 5, 6],
      p_kim: [2, 2, 2],
    });
    for (const phase of ["bidding", "after a bid"]) {
      if (phase === "after a bid")
        bid(r, "p_john", { quantity: 2, face: 2 }, t);
      const w = toWire(r, "p_sam", t);
      expect(w.players.map((p) => p.dice)).toEqual([null, [4, 5, 6], null]);
      expect(w.players.map((p) => p.diceCount)).toEqual([3, 3, 3]);
      expect(w.reveal).toBeNull();
      expect(JSON.stringify(w)).not.toContain("[1,2,3]");
      expect(JSON.stringify(w)).not.toContain("[2,2,2]");
    }
    const w = toWire(r, "p_sam", t);
    expect(w.wildOnes).toBe(true);
    expect(w.minFace).toBe(2);
    expect(w.rule).toMatch(/wild/);
    expect(w.bids).toEqual([
      { playerId: "p_john", quantity: 2, face: 2, auto: false },
    ]);
  });

  it("lifts every cup at a call, and hides them again on the next roll", () => {
    const r = room([SAM], "medium", { dice: 3 });
    const t = playing(r, { p_john: [1, 2, 3], p_sam: [4, 5, 6] });
    bid(r, "p_john", { quantity: 2, face: 2 }, t);
    liar(r, "p_sam", t + 1);
    const shown = toWire(r, "p_sam", t + 1);
    expect(shown.reveal!.dice).toEqual([
      { playerId: "p_john", dice: [1, 2, 3] },
      { playerId: "p_sam", dice: [4, 5, 6] },
    ]);
    // John had 1 + 2 = two 2s: the bid stands, Sam loses one.
    expect(shown.reveal).toMatchObject({ count: 2, loserId: "p_sam" });
    advance(r, t + 1 + REVEAL_MS, half);
    const next = toWire(r, "p_sam", t + 2 + REVEAL_MS);
    expect(next.reveal).toBeNull();
    expect(next.players[0].dice).toBeNull();
    expect(next.players[1].dice).toHaveLength(2);
    expect(next.turnId).toBe("p_sam");
  });

  it("leaves everything hidden in the lobby and countdown", () => {
    const r = room([SAM]);
    join(r, "p_sam", T0);
    start(r, "p_john", T0);
    const w = toWire(r, "p_sam", T0);
    expect(w.players.map((p) => p.dice)).toEqual([null, []]);
    expect(w.bid).toBeNull();
    expect(w.standings).toBeNull();
  });
});
