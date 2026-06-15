// src/lib/deepdive/report-prompt.test.ts
// Unit tests for the pure buildReportPrompt helper and the REPORT_SYSTEM constant.
// No network, no LLM calls.
import { describe, it, expect } from 'vitest';
import { buildReportPrompt, REPORT_SYSTEM } from './chat-context';

describe('REPORT_SYSTEM', () => {
  it('instructs the model to cite [n] markers', () => {
    expect(REPORT_SYSTEM).toContain('[n]');
  });

  it('instructs the model to use structured markdown headings', () => {
    expect(REPORT_SYSTEM.toLowerCase()).toContain('heading');
  });

  it('forbids fabrication', () => {
    expect(REPORT_SYSTEM.toLowerCase()).toContain('fabricat');
  });

  it('instructs gap disclosure when research does not cover an aspect', () => {
    expect(REPORT_SYSTEM.toLowerCase()).toContain('not cover');
  });
});

describe('buildReportPrompt', () => {
  const topic = 'Education funding reform';
  const brief = 'Analyse the impact of per-pupil funding changes on attainment gaps.';
  const overview = 'SESSION SUMMARY: Overview of funding policy levers.';
  const passages = '[1] (DfE)\nPer-pupil funding rose 3% in real terms between 2019 and 2022.\n\n[2] (Ofsted)\nThe disadvantage gap widened post-pandemic.';

  it('returns the REPORT_SYSTEM as the system prompt', () => {
    const { system } = buildReportPrompt(topic, brief, overview, passages);
    expect(system).toBe(REPORT_SYSTEM);
  });

  it('embeds the topic in the user prompt', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user).toContain(topic);
  });

  it('embeds the brief in the user prompt', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user).toContain(brief);
  });

  it('embeds the overview in the user prompt', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user).toContain(overview);
  });

  it('embeds the passages in the user prompt', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user).toContain('Per-pupil funding rose 3%');
  });

  it('includes the [n] passages block label', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user).toContain('RETRIEVED PASSAGES');
  });

  it('handles empty passages gracefully — emits a fallback note', () => {
    const { user } = buildReportPrompt(topic, brief, overview, '');
    expect(user).toContain('no closely-matching passages');
    expect(user).not.toContain('[1]');
  });

  it('asks the model to address the brief using session research as sole evidence', () => {
    const { user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user.toLowerCase()).toContain('sole evidence');
  });

  it('user prompt is a non-empty string distinct from the system prompt', () => {
    const { system, user } = buildReportPrompt(topic, brief, overview, passages);
    expect(user.length).toBeGreaterThan(0);
    expect(user).not.toBe(system);
  });
});
