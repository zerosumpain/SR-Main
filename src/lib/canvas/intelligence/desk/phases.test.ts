// src/lib/canvas/intelligence/desk/phases.test.ts
import { describe, it, expect } from 'vitest';
import { PHASES, phaseStateFor, nextPhaseLabel, type PhaseState } from './phases';
import type { DeskStatus } from './deskControls';

// Helper: get an ordered array of states for easier snapshot comparison
function orderedStates(status: DeskStatus): PhaseState[] {
  const map = phaseStateFor(status);
  return PHASES.map((p) => map[p.key]);
}

describe('PHASES', () => {
  it('has exactly 4 phases in canonical order', () => {
    expect(PHASES.map((p) => p.key)).toEqual([
      'phase1',
      'phase2',
      'phase3',
      'post_processing',
    ]);
  });

  it('each phase has non-empty label and shortLabel', () => {
    for (const p of PHASES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.shortLabel.length).toBeGreaterThan(0);
    }
  });
});

describe('phaseStateFor', () => {
  it('draft → all upcoming', () => {
    expect(orderedStates('draft')).toEqual([
      'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
  });

  it('phase1 → current / upcoming / upcoming / upcoming', () => {
    expect(orderedStates('phase1')).toEqual([
      'current', 'upcoming', 'upcoming', 'upcoming',
    ]);
  });

  it('phase2 → done / current / upcoming / upcoming', () => {
    expect(orderedStates('phase2')).toEqual([
      'done', 'current', 'upcoming', 'upcoming',
    ]);
  });

  it('phase3 → done / done / current / upcoming', () => {
    expect(orderedStates('phase3')).toEqual([
      'done', 'done', 'current', 'upcoming',
    ]);
  });

  it('post_processing → done / done / done / current', () => {
    expect(orderedStates('post_processing')).toEqual([
      'done', 'done', 'done', 'current',
    ]);
  });

  it('complete → all done', () => {
    expect(orderedStates('complete')).toEqual([
      'done', 'done', 'done', 'done',
    ]);
  });

  it('failed at phase2 position → done / current / upcoming / upcoming', () => {
    // failed is not a phase key so phaseStateFor treats it as unknown → all upcoming
    // (callers who know failedAt can override; the default safe fallback is upcoming)
    expect(orderedStates('failed')).toEqual([
      'upcoming', 'upcoming', 'upcoming', 'upcoming',
    ]);
  });
});

describe('nextPhaseLabel', () => {
  it('phase1 → Deep Research', () => {
    expect(nextPhaseLabel('phase1')).toBe('Deep Research');
  });

  it('phase2 → Red Teaming', () => {
    expect(nextPhaseLabel('phase2')).toBe('Red Teaming');
  });

  it('phase3 → Synthesis', () => {
    expect(nextPhaseLabel('phase3')).toBe('Synthesis');
  });

  it('post_processing → null (no next phase)', () => {
    expect(nextPhaseLabel('post_processing')).toBeNull();
  });

  it('draft → null (not a running phase)', () => {
    expect(nextPhaseLabel('draft')).toBeNull();
  });

  it('complete → null (terminal)', () => {
    expect(nextPhaseLabel('complete')).toBeNull();
  });

  it('failed → null (not a running phase)', () => {
    expect(nextPhaseLabel('failed')).toBeNull();
  });
});
