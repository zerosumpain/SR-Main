import { describe, it, expect } from 'vitest';
import {
  RESEARCH_DEPTHS,
  depthPreset,
  coerceDepth,
  isDepth,
  BRIEF_BUDGET_MS,
  DEFAULT_FAST_MODEL,
} from './depth';

describe('coerceDepth', () => {
  it('passes through every known depth', () => {
    for (const d of RESEARCH_DEPTHS) expect(coerceDepth(d)).toBe(d);
  });

  // The workflow node has been passing a `depth` string into research_start for
  // months and research_start never declared the param, so it was dropped.
  // Legacy vocabularies must land somewhere sensible rather than throwing.
  it('maps the legacy quick/deep vocabulary onto the new tiers', () => {
    expect(coerceDepth('quick')).toBe('scan');
    expect(coerceDepth('deep')).toBe('investigation');
  });

  it('maps the legacy analysisDepth vocabulary', () => {
    expect(coerceDepth('shallow')).toBe('scan');
    expect(coerceDepth('standard')).toBe('brief');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(coerceDepth('  Investigation ')).toBe('investigation');
    expect(coerceDepth('DEEP')).toBe('investigation');
  });

  it('falls back to brief for anything unrecognised, including null', () => {
    expect(coerceDepth(null)).toBe('brief');
    expect(coerceDepth(undefined)).toBe('brief');
    expect(coerceDepth('')).toBe('brief');
    expect(coerceDepth('exhaustive')).toBe('brief');
    expect(coerceDepth(42 as unknown as string)).toBe('brief');
  });
});

describe('isDepth', () => {
  it('accepts only exact canonical values', () => {
    expect(isDepth('brief')).toBe(true);
    expect(isDepth('quick')).toBe(false);
    expect(isDepth('BRIEF')).toBe(false);
  });
});

describe('depthPreset', () => {
  it('instant does no searching at all', () => {
    const p = depthPreset('instant');
    expect(p.runner).toBe('instant');
    expect(p.searches).toBe(false);
    expect(p.maxSources).toBe(0);
  });

  it('scan searches but never extracts facts', () => {
    const p = depthPreset('scan');
    expect(p.searches).toBe(true);
    expect(p.extractsFacts).toBe(false);
    expect(p.runner).toBe('scan');
  });

  it('brief extracts, and uses its own bounded runner rather than the phase chain', () => {
    const p = depthPreset('brief');
    expect(p.extractsFacts).toBe(true);
    expect(p.runner).toBe('brief');
    expect(p.phases).toEqual([]);
  });

  it('investigation runs the full phase chain', () => {
    const p = depthPreset('investigation');
    expect(p.runner).toBe('phases');
    expect(p.phases).toEqual(['phase1', 'phase2', 'phase3', 'post']);
  });

  // Only the unbudgeted tier may use the phase chain: those loops stop on
  // saturation heuristics, not on a clock, so they cannot honour a deadline.
  it('only the unbudgeted tier uses the phase chain', () => {
    for (const d of RESEARCH_DEPTHS) {
      const p = depthPreset(d);
      if (p.runner === 'phases') expect(p.budgetMs).toBeNull();
      else expect(p.phases).toEqual([]);
    }
  });

  // The sub-2-minute promise. A budget at or above 120s would leave no headroom
  // for the response to actually reach the browser.
  it('brief is budgeted strictly under two minutes', () => {
    expect(BRIEF_BUDGET_MS).toBeLessThan(120_000);
    expect(depthPreset('brief').budgetMs).toBe(BRIEF_BUDGET_MS);
  });

  it('reserves synthesis time on every budgeted tier', () => {
    for (const d of ['instant', 'scan', 'brief'] as const) {
      const p = depthPreset(d);
      expect(p.budgetMs).not.toBeNull();
      expect(p.reserves.synthesis).toBeGreaterThan(0);
      // A reserve that swallowed the whole budget would leave no gathering time.
      expect(p.reserves.synthesis!).toBeLessThan(p.budgetMs!);
    }
  });

  it('leaves investigation unbudgeted by default', () => {
    expect(depthPreset('investigation').budgetMs).toBeNull();
  });

  it('budgets rise monotonically with depth', () => {
    const ms = (d: 'instant' | 'scan' | 'brief') => depthPreset(d).budgetMs!;
    expect(ms('instant')).toBeLessThan(ms('scan'));
    expect(ms('scan')).toBeLessThan(ms('brief'));
  });

  // Fast tiers must not inherit the site default: it may be a reasoning model
  // (reasoning tokens eat max_tokens and add tens of seconds) or a codex/ id
  // (~10s on the first call). Either would blow a 110s budget on its own.
  it('pins a model on the fast tiers and leaves investigation on the site default', () => {
    expect(depthPreset('instant').pinnedModel).toBeTruthy();
    expect(depthPreset('scan').pinnedModel).toBeTruthy();
    expect(depthPreset('brief').pinnedModel).toBeTruthy();
    expect(depthPreset('investigation').pinnedModel).toBeNull();
  });

  it('never pins a codex model on a budgeted tier', () => {
    for (const d of ['instant', 'scan', 'brief'] as const) {
      expect(depthPreset(d).pinnedModel).not.toMatch(/^codex\//);
    }
  });

  // Regression: the pin was originally derived from getFallbackModel(), which
  // is the RATE-LIMIT fallback and is configured to a reasoning model on at
  // least one install (z-ai/glm-5-turbo). A brief run on it burned the whole
  // 110s budget and returned an empty answer — reasoning tokens consume
  // max_tokens before any content is emitted. The pin must not track a setting
  // that exists for a different purpose.
  it('pins a fixed fast model rather than tracking the rate-limit fallback', () => {
    expect(depthPreset('brief').pinnedModel).toBe(DEFAULT_FAST_MODEL);
    expect(DEFAULT_FAST_MODEL).not.toMatch(/glm|reason|thinking/i);
  });

  it('produces a SessionConfig the existing phases can consume', () => {
    const p = depthPreset('investigation');
    expect(p.config.maxSources).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(p.config.diversityThreshold);
    expect(['shallow', 'standard', 'deep']).toContain(p.config.analysisDepth);
    expect(['gentle', 'standard', 'aggressive']).toContain(p.config.redTeamAggression);
  });

  it('every depth carries user-facing label and blurb', () => {
    for (const d of RESEARCH_DEPTHS) {
      const p = depthPreset(d);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
    }
  });

  it('coerces unknown input before presetting rather than throwing', () => {
    expect(depthPreset('nonsense' as never).depth).toBe('brief');
  });
});
