import { describe, it, expect, beforeEach } from 'vitest';
import { SimEngine, type Scenario, type SimEvent } from './engine';

const POOL = { suppliers: ['sup-a', 'sup-b'], consumers: ['con-la'], hub: 'con-dfe', ledger: 'ledger' };

function fixture(): Scenario {
  return {
    id: 'test', group: 'g', title: 'T', tagline: 'tag', description: 'd', lesson: 'l',
    central: { records: 'r', exposure: 'e', note: 'n' },
    steps: [
      {
        narration: 'step one', phase: 'CONTRACT', holdMs: 1000,
        actions: [
          { kind: 'pulse', from: 'con-dfe', to: 'sup-a', color: 'query' },
          { kind: 'log', log: 'contract', text: 'contract issued' },
          { kind: 'flash', node: 'sup-a', color: 'ok', delayMs: 500 },
        ],
      },
      {
        narration: 'step two', holdMs: 800,
        actions: [{ kind: 'counter', key: 'aggregatesReturned', delta: 1 }],
      },
    ],
  };
}

describe('SimEngine', () => {
  let engine: SimEngine;
  let events: SimEvent[];

  beforeEach(() => {
    engine = new SimEngine(POOL);
    events = [];
    engine.subscribe((e) => events.push(e));
  });

  it('starts a scenario with clear + start + first narration + immediate actions', () => {
    engine.loadScenario(fixture());
    const types = events.map((e) => e.type);
    expect(types).toEqual(['clear', 'scenario-start', 'narrate', 'pulse', 'log']);
    const log = events.find((e) => e.type === 'log');
    expect(log && log.type === 'log' && log.entry.sig).toMatch(/^sig:/);
  });

  it('fires delayed actions at the right engine time and honours speed', () => {
    engine.loadScenario(fixture());
    engine.setSpeed(2);
    engine.tick(200); // 400 scaled — flash not yet due (500)
    expect(events.some((e) => e.type === 'flash')).toBe(false);
    engine.tick(100); // 600 scaled total
    expect(events.some((e) => e.type === 'flash')).toBe(true);
  });

  it('advances steps after holdMs and ends the scenario', () => {
    engine.loadScenario(fixture());
    for (let i = 0; i < 11; i++) engine.tick(100); // 1100ms — past step 1 hold
    expect(events.filter((e) => e.type === 'narrate')).toHaveLength(2);
    for (let i = 0; i < 9; i++) engine.tick(100);
    expect(events.some((e) => e.type === 'scenario-end')).toBe(true);
    expect(engine.activeScenario).toBeNull();
  });

  it('pause halts progression; stepForward completes the beat instantly', () => {
    engine.loadScenario(fixture());
    engine.pause();
    engine.tick(5000);
    expect(events.filter((e) => e.type === 'narrate')).toHaveLength(1);
    engine.stepForward();
    // delayed flash flushed + step two began
    expect(events.some((e) => e.type === 'flash')).toBe(true);
    expect(events.filter((e) => e.type === 'narrate')).toHaveLength(2);
  });

  it('multi-count pulses spread over time', () => {
    engine.loadScenario({
      ...fixture(),
      steps: [{ narration: 'n', holdMs: 2000, actions: [{ kind: 'pulse', from: 'a', to: 'b', color: 'data', count: 3, spreadMs: 100 }] }],
    });
    expect(events.filter((e) => e.type === 'pulse')).toHaveLength(1);
    engine.tick(250);
    expect(events.filter((e) => e.type === 'pulse')).toHaveLength(3);
  });

  it('emits ambient traffic when idle, none while a scenario plays', () => {
    for (let i = 0; i < 40; i++) engine.tick(100); // 4s idle
    const ambient = events.filter((e) => e.type === 'pulse' || e.type === 'flash');
    expect(ambient.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'counter' && e.key === 'exchanges')).toBe(true);

    events.length = 0;
    engine.loadScenario(fixture());
    engine.tick(400);
    const colors = events.filter((e) => e.type === 'pulse').map((e) => (e.type === 'pulse' ? e.color : ''));
    expect(colors).not.toContain('ambient');
  });

  it('restart works after a scenario has ended (replay path)', () => {
    engine.loadScenario(fixture());
    for (let i = 0; i < 20; i++) engine.tick(100); // run to completion
    expect(events.some((e) => e.type === 'scenario-end')).toBe(true);
    events.length = 0;
    engine.restart();
    expect(events.map((e) => e.type)).toContain('scenario-start');
    expect(engine.activeScenario?.id).toBe('test');
  });

  it('pulse travel time scales with speed', () => {
    engine.loadScenario(fixture());
    const p1 = events.find((e) => e.type === 'pulse');
    expect(p1 && p1.type === 'pulse' && p1.durMs).toBe(1600);
    engine.setSpeed(2);
    engine.restart();
    const pulses = events.filter((e) => e.type === 'pulse');
    const p2 = pulses[pulses.length - 1];
    expect(p2 && p2.type === 'pulse' && p2.durMs).toBe(800);
  });

  it('stop clears and returns to idle', () => {
    engine.loadScenario(fixture());
    engine.stop();
    expect(events.map((e) => e.type)).toContain('stopped');
    expect(engine.activeScenario).toBeNull();
    expect(engine.playing).toBe(false);
  });
});
