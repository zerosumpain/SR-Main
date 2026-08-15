import { describe, it, expect } from 'vitest';
import { PHASE_ORDER, startPhaseIndex, resumePhase, isResearchPhase } from './phase-order';

describe('startPhaseIndex', () => {
  it('maps each phase to its own position', () => {
    PHASE_ORDER.forEach((phase, i) => {
      expect(startPhaseIndex(phase)).toBe(i);
    });
  });

  it('starts at the beginning for anything that is not a phase', () => {
    for (const status of ['draft', 'complete', 'failed', 'paused', 'cancelled', 'phase9', '', null, undefined]) {
      expect(startPhaseIndex(status)).toBe(0);
    }
  });
});

describe('resumePhase', () => {
  it('prefers resumeFrom, because a paused row has lost its phase from status', () => {
    expect(resumePhase({ status: 'paused', resumeFrom: 'phase3' })).toBe('phase3');
  });

  it('falls back to status for a stranded run nobody paused', () => {
    expect(resumePhase({ status: 'phase2', resumeFrom: null })).toBe('phase2');
  });

  it('starts over when neither field names a phase', () => {
    expect(resumePhase({ status: 'draft', resumeFrom: null })).toBe('phase1');
    expect(resumePhase({ status: 'paused', resumeFrom: null })).toBe('phase1');
    expect(resumePhase({ status: null })).toBe('phase1');
  });

  it('ignores a resumeFrom that is not a real phase rather than trusting it', () => {
    expect(resumePhase({ status: 'phase2', resumeFrom: 'complete' })).toBe('phase2');
  });
});

describe('isResearchPhase', () => {
  it('accepts only the four phases', () => {
    expect(isResearchPhase('phase1')).toBe(true);
    expect(isResearchPhase('post_processing')).toBe(true);
    expect(isResearchPhase('paused')).toBe(false);
    expect(isResearchPhase(2)).toBe(false);
  });
});
