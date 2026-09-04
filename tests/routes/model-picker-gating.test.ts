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
 * The model picker was hidden behind an engine flag that had been false since
 * the cutover — so every conversation ran on the site default, not because the
 * pin stopped working but because there was no way to set it. The chat loop
 * honours the pin perfectly well; it coerces `conv.modelProvider` /
 * `conv.modelId` on every turn, and the PATCH below IS the switch.
 *
 * The `/model` push that used to follow the PATCH is gone with the gateway that
 * interpreted it. What remains worth pinning is that nothing re-introduces a
 * chat turn to change a model, and that a silent turn cannot post a bubble.
 *
 * Source assertions, because the property is an ORDER of operations and a
 * template condition, neither of which a unit test can reach without a browser.
 */

describe('the model picker is reachable again', () => {
  it('is no longer gated on the chat engine', () => {
    // The switcher opens under `{#if conversationId}` on its own now.
    expect(CHAT_AREA).toMatch(/\{#if conversationId\}\s*\n\s*<div class="model-switcher">/);
  });

  it('carries no engine flag at all any more', () => {
    // The prop, the gated surfaces and the flag itself are gone. A reappearance
    // means someone re-added a branch for an engine that does not exist.
    expect(CHAT_AREA).not.toContain('hermesEnabled');
  });

  it('offers no pinned-skill chip', () => {
    // No server has ever read `pinnedSkill` since the cutover — the control
    // would be a setting that does nothing.
    expect(CHAT_AREA).not.toContain('pinnedSkill');
  });
});

describe('switching a model does not cost a turn', () => {
  it('persists the switch with a PATCH and tells the parent', () => {
    // The PATCH is the actual switch. Returning before it, or before
    // `onmodelchange`, would make the picker look broken.
    const patch = CHAT_AREA.indexOf("method: 'PATCH'");
    // Prefix, not the whole statement: the callback also reports whether the
    // NEW model takes a thinking level, and the ordering is what this guards.
    const notify = CHAT_AREA.indexOf('onmodelchange?.({ provider, modelId }');
    expect(patch).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(patch);
  });

  it('pushes no /model command as a chat turn', () => {
    // The gateway that read `/model` is gone. Posting one now would bill a turn
    // to tell the loop something it already read off the conversation row.
    expect(CHAT_AREA).not.toContain('tellHermesModel');
    expect(CHAT_AREA).not.toMatch(/message: .{0,20}[Mm]odelCommand/);
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

describe('the in-flight reply is actually visible', () => {
  it('renders accumulated token content before the done frame clears isProgress', () => {
    const start = CHAT_AREA.indexOf('{:else if msg.isProgress}');
    const end = CHAT_AREA.indexOf("{:else if msg.source === 'status_update'}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const progressBranch = CHAT_AREA.slice(start, end);
    expect(progressBranch).toContain('data-live-reply');
    expect(progressBranch).toMatch(/<ChatMessage[\s\S]*content=\{[^}]*msg\.content/);
  });
});
