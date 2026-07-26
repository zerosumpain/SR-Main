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
  it('counts the wait before the first token against the rate', () => {
    bus.beginTurn(); // clock starts here, at 0
    clock = 1_000; // one second of time-to-first-token
    bus.noteOutput('a'.repeat(400)); // 100 estimated tokens
    clock = 2_000; // one second of generation
    bus.settleTurn();

    // 100 tokens over the full 2s, not over the 1s of generation alone.
    expect(bus.throughput.activeMs).toBe(2_000);
    expect(bus.throughput.lastTps).toBeCloseTo(50, 5);
    expect(bus.throughput.lastActual).toBe(false);
    expect(bus.throughput.live).toBe(false);
  });

  it('excludes tool execution time', () => {
    bus.beginTurn();
    bus.noteOutput('x'.repeat(200)); // 50 tokens
    clock = 500;
    bus.noteToolStart({}); // empty args bill nothing; pauses the clock
    clock = 5_500; // the tool ran for 5s of dead time
    bus.noteToolEnd();
    bus.noteOutput('y'.repeat(200)); // 50 tokens
    clock = 6_000;
    bus.settleTurn();

    // 6s of wall clock minus the tool's 5s.
    expect(bus.throughput.activeMs).toBe(1_000);
    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
  });

  it("counts the provider's prefill wait after a tool returns", () => {
    bus.beginTurn();
    bus.noteOutput('x'.repeat(400)); // 100 tokens
    clock = 1_000;
    bus.noteToolStart({});
    clock = 1_100; // the tool itself was quick (100ms, excluded)
    bus.noteToolEnd();
    clock = 9_100; // the provider then took 8s to start emitting again
    bus.noteOutput('y'.repeat(400)); // 100 tokens
    clock = 10_100;
    bus.settleTurn();

    // Everything except the tool's own 100ms.
    expect(bus.throughput.activeMs).toBe(10_000);
    expect(bus.throughput.lastTps).toBeCloseTo(20, 5);
  });

  it('resumes only once every parallel tool has reported back', () => {
    bus.beginTurn();
    bus.noteOutput('a'.repeat(400)); // 100 tokens
    clock = 1_000;
    bus.noteToolStart({}); // two tools fan out
    bus.noteToolStart({});
    clock = 3_000;
    bus.noteToolEnd(); // first returns — one still running, stay paused
    clock = 5_000;
    bus.noteToolEnd(); // last returns — clock resumes here
    clock = 6_000;
    bus.settleTurn();

    // 1s before the fan-out + 1s after the last return; the 4s window is out.
    expect(bus.throughput.activeMs).toBe(2_000);
    expect(bus.throughput.lastTps).toBeCloseTo(50, 5);
  });

  it('recovers when a tool never reports back', () => {
    bus.beginTurn();
    bus.noteOutput('a'.repeat(400));
    clock = 1_000;
    bus.noteToolStart({}); // no matching noteToolEnd ever arrives
    clock = 3_000;
    bus.noteOutput('b'.repeat(400)); // tokens flowing again heals the clock
    clock = 4_000;
    bus.settleTurn();

    // The stranded 2s window stays excluded, but the final 1s is counted —
    // the clock is not stuck paused for the rest of the turn.
    expect(bus.throughput.activeMs).toBe(2_000);
    expect(bus.throughput.lastTps).toBeCloseTo(100, 5);
  });

  it('bills tool-call argument JSON as generated output', () => {
    const args = { query: 'z'.repeat(360), limit: 5 };
    const argChars = JSON.stringify(args).length;

    bus.beginTurn();
    bus.noteOutput('a'.repeat(40));
    clock = 1_000;
    bus.noteToolStart(args);
    bus.settleTurn();

    const expectedTokens = Math.round((40 + argChars) / 4);
    expect(bus.throughput.chars).toBe(40 + argChars);
    expect(bus.throughput.lastTps).toBeCloseTo(expectedTokens, 5);
  });

  it('counts reasoning deltas alongside reply text', () => {
    bus.beginTurn();
    bus.noteOutput('t'.repeat(200)); // reply
    bus.noteOutput('r'.repeat(200)); // thinking — both are output
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
    expect(bus.throughput.startedAt).toBeNull();
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
    expect(bus.throughput.startedAt).toBeNull();

    bus.beginTurn();
    bus.noteOutput('');
    bus.noteOutput(undefined);
    expect(bus.throughput.chars).toBe(0);
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
