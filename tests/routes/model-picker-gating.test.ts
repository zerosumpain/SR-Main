import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const CHAT_AREA = readFileSync(resolve(ROOT, 'src/lib/components/jkai/ChatArea.svelte'), 'utf8');
const CHAT_ROUTE = readFileSync(
  resolve(ROOT, 'src/routes/api/workflows/orchestrator/chat/+server.ts'),
  'utf8',
);

/**
 * The model picker was hidden behind `hermesEnabled`, which has been false
 * since the cutover — so every conversation since has run on the site default,
 * not because the pin stopped working but because there was no way to set it.
 * The loop honours the pin perfectly well; it coerces `conv.modelProvider` /
 * `conv.modelId` on every turn.
 *
 * Un-gating it alone would have been a regression. `switchModel` pushed a
 * `/model` command as a chat turn — Hermes-era plumbing the loop has no use for
 * — and `handleWithLoop` did not read `silent`, so every switch would have
 * posted a visible user bubble and billed a full turn.
 *
 * Source assertions, because the property is an ORDER of two gates and a
 * template condition, none of which a unit test can reach without a browser.
 */

describe('the model picker is reachable again', () => {
  it('is no longer gated on the chat engine', () => {
    // The switcher opens under `{#if conversationId}` on its own now.
    expect(CHAT_AREA).toMatch(/\{#if conversationId\}\s*\n\s*<div class="model-switcher">/);
  });

  it('does not gate the switcher on hermesEnabled', () => {
    const at = CHAT_AREA.indexOf('<div class="model-switcher">');
    expect(at).toBeGreaterThan(-1);
    // Whatever `{#if}` most recently opened before the switcher must not be the
    // engine flag.
    const before = CHAT_AREA.slice(0, at);
    const lastIf = before.lastIndexOf('{#if ');
    const condition = before.slice(lastIf, lastIf + 60);
    expect(condition).not.toContain('hermesEnabled');
  });

  it('keeps the skill chip gated — the loop has no pinned-skill concept', () => {
    // `handleWithLoop` never reads `pinnedSkill`; offering the control would be
    // offering a setting that does nothing.
    expect(CHAT_AREA).toMatch(/\{#if hermesEnabled && conversationId\}\s*\n\s*<div class="model-switcher skill-switcher">/);
  });
});

describe('switching a model does not cost a turn on the loop', () => {
  it('skips the /model push when Hermes is not the engine', () => {
    expect(CHAT_AREA).toMatch(/if \(!hermesEnabled\) return;/);
  });

  it('still persists the switch and updates the UI before bailing', () => {
    // The PATCH is the actual switch on this engine. Returning before it, or
    // before `onmodelchange`, would make the picker look broken.
    const guard = CHAT_AREA.indexOf('if (!hermesEnabled) return;');
    // Prefix, not the whole statement: the callback also reports whether the
    // NEW model takes a thinking level, and the ordering is what this guards.
    const notify = CHAT_AREA.indexOf('onmodelchange?.({ provider, modelId }');
    const patch = CHAT_AREA.indexOf('method: \'PATCH\'');
    expect(patch).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(patch);
    expect(guard).toBeGreaterThan(notify);
  });

  it('leaves the open-time push gated on the same flag', () => {
    // Both push sites, one rule.
    expect(CHAT_AREA).toMatch(/const on = hermesEnabled;/);
  });
});

describe('a stray /model push cannot post a bubble', () => {
  it('handleWithLoop reads silent', () => {
    // Defence in depth: the client no longer sends one at this engine, and the
    // server no longer persists a user row for one if it arrives.
    expect(CHAT_ROUTE).toMatch(/intelEntityIds,\s*silent\s*\}/);
    expect(CHAT_ROUTE).toMatch(/silent\?: boolean;/);
  });

  it('guards both user-message inserts on it', () => {
    // Two inserts — the conversation branch and the workflow branch. Missing
    // one would leave the bubble on whichever path was not covered.
    const guarded = CHAT_ROUTE.match(/if \(!silent\) \{\s*\n\s*const \[m\] = await db\.insert\(orchestratorChats\)/g);
    expect(guarded?.length).toBe(2);
  });
});
