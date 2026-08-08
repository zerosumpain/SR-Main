import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildIterationContext } from './prompt';

// Repo mode exists because a change-request build used to be handed the
// standalone-app prompt: it was told to write a serve.json and get a preview
// responding before any feature code, inside a clone of this repo. Builds #125
// and #126 did exactly that on 2026-08-07, at ~1.5M tokens each, and neither
// opened a PR. These assertions pin the separation.

describe('buildSystemPrompt', () => {
  it('gives app builds the preview-server instructions', () => {
    const p = buildSystemPrompt('b1', 8123, 'app');
    expect(p).toContain('serve.json');
    expect(p).toContain('8123');
  });

  it('defaults to app mode for existing callers', () => {
    expect(buildSystemPrompt('b1', 8123)).toContain('serve.json');
  });

  it('never tells a repo build to build an app', () => {
    const p = buildSystemPrompt('b1', 8123, 'repo');
    expect(p).toMatch(/reviewable diff/i);
    // serve.json appears only as a prohibition, never as an instruction.
    expect(p).toMatch(/Do NOT create serve\.json/);
    expect(p).not.toMatch(/write a valid serve\.json/i);
    expect(p).not.toMatch(/POST to the events endpoint/i);
    expect(p).not.toContain('cdn.tailwindcss.com');
  });

  it('does not leak a serving port into a repo build', () => {
    expect(buildSystemPrompt('b1', 8123, 'repo')).not.toContain('8123');
  });

  it('tells a repo build the orchestrator owns the branch and the PR', () => {
    const p = buildSystemPrompt('b1', 8123, 'repo');
    expect(p).toMatch(/do not commit or push/i);
  });

  it('tells a repo build the gate is not its to run', () => {
    // Every command the agent runs is killed at 300s by the agent runtime;
    // the gate takes longer, so running it can only ever time out. The
    // orchestrator runs it afterwards and feeds the result back.
    const p = buildSystemPrompt('b1', 8123, 'repo');
    expect(p).toMatch(/DO NOT RUN THE FULL GATE YOURSELF/);
    expect(p).toMatch(/300 seconds/);
    expect(p).toMatch(/orchestrator runs the full gate for you/i);
    expect(p).toMatch(/narrowly/i);
  });
});

describe('buildIterationContext', () => {
  const ctx = (mode: 'app' | 'repo', gate: string | null = null) =>
    buildIterationContext('do the thing', null, '', null, 2, 8123, '', mode, gate)[0].content;

  it('assigns a serving port in app mode', () => {
    expect(ctx('app')).toContain('Assigned Serving Port');
  });

  it('replaces the port with the gate command in repo mode', () => {
    const c = ctx('repo', 'npm run gate');
    expect(c).not.toContain('Assigned Serving Port');
    expect(c).toContain('Definition of Done');
    expect(c).toContain('npm run gate');
  });

  it('omits the definition of done when there is no gate command', () => {
    expect(ctx('repo', null)).not.toContain('Definition of Done');
  });
});
