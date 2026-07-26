import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The bus is a module-level singleton, so each test gets a fresh copy via
// resetModules + dynamic import. `performance.now` is faked so the timing
// assertions are exact rather than wall-clock-dependent.
type Bus = typeof import('./throughput-bus.svelte');

let bus: Bus;
let clock = 0;

beforeEach(async () => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.resetModules();
  bus = await import('./throughput-bus.svelte');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('throughput accounting', () => {
  it('rates a plain stream as tokens over elapsed generation time', () => {
    bus.beginTurn();
    clock = 1_000;
    bus.noteOutput('a'.repeat(400)); // 100 estimated tokens, clock starts here
    clock = 2_000;
    bus.settleTurn();

    expect(bus.throughput.activeMs).toBe(1_000);
    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
    expect(bus.throughput.lastActual).toBe(false);
    expect(bus.throughput.live).toBe(false);
  });

  it('excludes tool execution time from the denominator', () => {
    bus.beginTurn();
    bus.noteOutput('x'.repeat(200)); // 50 tokens, clock starts at 0
    clock = 500;
    bus.noteToolCall({}); // empty args bill nothing; pauses the clock
    clock = 5_500; // the tool ran for 5s of dead time
    bus.noteOutput('y'.repeat(200)); // 50 tokens, clock restarts at 5,500
    clock = 6_000;
    bus.settleTurn();

    // 6s of wall clock, but only 1s of generation.
    expect(bus.throughput.activeMs).toBe(1_000);
    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
  });

  it('excludes the provider wait between a tool finishing and the next delta', () => {
    bus.beginTurn();
    bus.noteOutput('x'.repeat(400));
    clock = 1_000;
    bus.noteToolCall({});
    clock = 1_100; // tool itself was quick...
    clock = 9_100; // ...but the provider took 8s to start emitting again
    bus.noteOutput('y'.repeat(400));
    clock = 10_100;
    bus.settleTurn();

    expect(bus.throughput.activeMs).toBe(2_000);
    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
  });

  it('bills tool-call argument JSON as generated output', () => {
    const args = { query: 'z'.repeat(360), limit: 5 };
    const argChars = JSON.stringify(args).length;

    bus.beginTurn();
    bus.noteOutput('a'.repeat(40));
    clock = 1_000;
    bus.noteToolCall(args);
    bus.settleTurn();

    const expectedTokens = Math.round((40 + argChars) / 4);
    expect(bus.throughput.chars).toBe(40 + argChars);
    expect(bus.throughput.lastTps).toBeCloseTo(expectedTokens, 5);
  });

  it('counts reasoning deltas alongside reply text', () => {
    bus.beginTurn();
    bus.noteOutput('t'.repeat(200)); // reply
    bus.noteOutput('r'.repeat(200)); // thinking — same call, both are output
    clock = 1_000;
    bus.settleTurn();

    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
  });

  it("prefers the provider's token count over the streamed estimate", () => {
    bus.beginTurn();
    bus.noteOutput('a'.repeat(400)); // estimate says 100 tokens
    clock = 1_000;
    bus.settleTurn(250); // provider says 250

    expect(bus.throughput.lastTps).toBeCloseTo(250, 5);
    expect(bus.throughput.lastActual).toBe(true);
  });

  it('publishes nothing for a replayed turn', () => {
    bus.beginTurn({ replay: true });
    bus.noteOutput('a'.repeat(4_000)); // a buffered burst, all at clock 0
    bus.settleTurn(1_000);

    expect(bus.throughput.live).toBe(false);
    expect(bus.throughput.lastTps).toBeNull();
    expect(bus.throughput.sessionTokens).toBe(0);
  });

  it('suppresses samples too small to be meaningful', () => {
    bus.beginTurn();
    bus.noteOutput('ab'); // well under the token floor
    clock = 1_000;
    bus.settleTurn();
    expect(bus.throughput.lastTps).toBeNull();

    // Plenty of tokens, but over a stretch too short to time reliably.
    bus.beginTurn();
    bus.noteOutput('a'.repeat(400));
    clock = 1_100;
    bus.settleTurn();
    expect(bus.throughput.lastTps).toBeNull();
  });

  it('accumulates a session average across turns and ignores a repeat settle', () => {
    bus.beginTurn();
    bus.noteOutput('a'.repeat(400)); // 100 tokens in 1s
    clock = 1_000;
    bus.settleTurn();

    bus.beginTurn();
    bus.noteOutput('b'.repeat(1_200)); // 300 tokens in 1s
    clock = 2_000;
    bus.settleTurn();
    bus.settleTurn(); // backstop call — must not double-count

    expect(bus.throughput.sessionTokens).toBe(400);
    expect(bus.throughput.sessionActiveMs).toBe(2_000);
    expect(bus.rate(bus.throughput.sessionTokens, bus.throughput.sessionActiveMs)).toBeCloseTo(200, 5);
    // The last-turn figure is the second turn's, not the blended average.
    expect(bus.throughput.lastTps).toBeCloseTo(300, 5);
  });

  it('ignores notes outside a turn and empty deltas', () => {
    bus.noteOutput('a'.repeat(400)); // no beginTurn yet
    expect(bus.throughput.chars).toBe(0);

    bus.beginTurn();
    bus.noteOutput('');
    bus.noteOutput(undefined);
    expect(bus.throughput.chars).toBe(0);
    expect(bus.throughput.startedAt).toBeNull();
  });

  it('marks a turn live from begin until settle', () => {
    expect(bus.throughput.live).toBe(false);
    bus.beginTurn();
    expect(bus.throughput.live).toBe(true);
    bus.noteOutput('a'.repeat(400));
    clock = 1_000;
    expect(bus.throughput.live).toBe(true);
    bus.settleTurn();
    expect(bus.throughput.live).toBe(false);
  });
});
