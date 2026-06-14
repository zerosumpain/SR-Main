// src/lib/canvas/intelligence/desk/deskControls.test.ts
import { describe, it, expect } from 'vitest';
import { statusPill, controlState, type DeskStatus } from './deskControls';

describe('statusPill', () => {
  it('labels active phases as gathering with success hue', () => {
    for (const s of ['phase1', 'phase2', 'phase3', 'post_processing'] as DeskStatus[]) {
      const p = statusPill(s, false);
      expect(p.label.toLowerCase()).toContain('gathering');
      expect(p.hue).toBe('success');
    }
  });

  it('shows the phase number in the label', () => {
    expect(statusPill('phase1', false).label).toContain('1');
    expect(statusPill('phase3', false).label).toContain('3');
  });

  it('shows synthesising with accent hue when a synthesis run is live, overriding status', () => {
    const p = statusPill('phase2', true);
    expect(p.label.toLowerCase()).toContain('synthesising');
    expect(p.hue).toBe('accent');
  });

  it('labels complete and failed terminal states', () => {
    expect(statusPill('complete', false).label.toLowerCase()).toContain('complete');
    expect(statusPill('complete', false).hue).toBe('neutral');
    expect(statusPill('failed', false).label.toLowerCase()).toContain('failed');
    expect(statusPill('failed', false).hue).toBe('error');
  });

  it('synthesising on a complete session still reads synthesising', () => {
    const p = statusPill('complete', true);
    expect(p.label.toLowerCase()).toContain('synthesising');
    expect(p.hue).toBe('accent');
  });
});

describe('controlState', () => {
  it('allows pause/stop while the engine is running, not deepen', () => {
    const c = controlState('phase2', false);
    expect(c.canPause).toBe(true);
    expect(c.canStop).toBe(true);
    expect(c.canDeepen).toBe(false);
  });

  it('allows deepen/share once complete, not pause/stop', () => {
    const c = controlState('complete', false);
    expect(c.canPause).toBe(false);
    expect(c.canStop).toBe(false);
    expect(c.canDeepen).toBe(true);
    expect(c.canShare).toBe(true);
  });

  it('never enables pause while synthesising even mid-run', () => {
    expect(controlState('phase2', true).canPause).toBe(false);
  });

  it('share/export always available except in draft', () => {
    expect(controlState('draft', false).canShare).toBe(false);
    expect(controlState('phase1', false).canShare).toBe(true);
    expect(controlState('complete', false).canShare).toBe(true);
  });
});
