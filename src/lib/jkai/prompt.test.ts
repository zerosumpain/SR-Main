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

describe('studio prompt mode', () => {
  const p = buildSystemPrompt('b1', 8123, 'studio');

  it('does not carry the app mode wrap-up-at-200 hard stop', () => {
    expect(p).not.toContain('at least one route returns a 200. → Wrap up');
    expect(p).not.toContain("You've been working for 15 minutes");
  });

  it('does not recommend Tailwind, which the linter rejects', () => {
    expect(p).not.toMatch(/cdn\.tailwindcss\.com/);
  });

  it('states the four-part chapter contract', () => {
    expect(p).toContain('data-chapter');
    expect(p).toContain('data-lever');
    expect(p).toContain('data-outcome');
    expect(p).toContain('data-citation');
  });

  it('points at the explainer kit mount', () => {
    expect(p).toContain('./explainer-kit/');
    expect(p).toContain('scenes.md');
  });

  it('still carries the port and workspace footer', () => {
    expect(p).toContain('/home/jkai/workspace/b1/dev');
    expect(p).toContain('8123');
  });

  it('leaves app and repo modes untouched', () => {
    expect(buildSystemPrompt('b1', 8123, 'app')).toContain('SHIP THE THINNEST RUNNABLE PREVIEW');
    expect(buildSystemPrompt('b1', 8123, 'repo')).toContain('THE DELIVERABLE IS A REVIEWABLE DIFF');
  });

  it('injects the chapter plan into iteration context', () => {
    const msgs = buildIterationContext(
      'explain school funding', null, '', null, 4, 8123, '', 'studio', null,
      [{ n: 1, title: 'What a school budget is', leverId: 'roll', outcomeId: 'total' }],
    );
    expect(msgs[0].content).toContain('Chapter Plan');
    expect(msgs[0].content).toContain('What a school budget is');
    expect(msgs[0].content).toContain('iteration 4');
  });
});

// The agent could not see its own work. Across eight builds it made 59
// attempts to open a browser and 39 died on MODULE_NOT_FOUND, because the
// prompt promised a Playwright that does not resolve from the workspace.
describe('the studio prompt tells the agent how to look at its own work', () => {
  const prompt = buildSystemPrompt('b1', 4310, 'studio');

  it('names a runnable command with the real port substituted', () => {
    expect(prompt).toContain('scripts/studio-verify.mjs');
    expect(prompt).toContain('http://127.0.0.1:4310');
  });

  // A leaked placeholder would name a command that does not exist — the same
  // class of lie as the claim it replaced.
  it('leaves no placeholder behind', () => {
    expect(prompt).not.toContain('__STUDIO_VERIFY_CMD__');
    expect(prompt).not.toContain('$PORT');
  });

  it('no longer claims Playwright is installed and ready to use', () => {
    const hostLine = prompt.split('\n').find((l) => l.startsWith('HOST ENVIRONMENT'));
    expect(hostLine).toBeDefined();
    expect(hostLine).not.toContain('Playwright');
  });

  it('warns the agent off writing its own browser script', () => {
    expect(prompt).toContain("import('playwright')");
    expect(prompt.toLowerCase()).toContain('will not resolve');
  });

  it('points at the spine file the checker reads', () => {
    expect(prompt).toContain('.studio/spine.json');
  });
});

describe('the studio prompt points at the real materials', () => {
  const prompt = buildSystemPrompt('b1', 4310, 'studio');

  it('names the illustration generator with no placeholder left', () => {
    expect(prompt).toContain('scripts/studio-image.mjs');
    expect(prompt).not.toContain('__STUDIO_IMAGE_CMD__');
  });

  it('tells the agent to mount the chrome rather than author it', () => {
    expect(prompt).toContain('mountShell');
    expect(prompt).toContain('api.md');
  });

  // The 3D mandate pointed at the one technique the house style does not use:
  // policy-engine is 40 inline SVGs with zero canvas.
  it('makes the SVG instruments the default and the scene the exception', () => {
    expect(prompt).toContain('createSteps');
    expect(prompt).toContain('createInstrument');
    expect(prompt).toMatch(/EXCEPTION, not the default/i);
  });

  it('forbids a generated image carrying a number', () => {
    expect(prompt).toContain('Never let a generated image carry a number');
  });
});
