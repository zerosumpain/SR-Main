import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SRC = readFileSync(resolve(ROOT, 'src/lib/workflows/chat/general-chat.ts'), 'utf8');

/**
 * A thread's thinking level only means anything if it reaches the request.
 *
 * These are source assertions for the same reason prompt-cache-order.test.ts
 * is: proving it at runtime means standing up the whole tool loop — a DB, a
 * SvelteKit request context, the site toolsets — to observe one field on one
 * request body. The mapping itself is unit-tested in $lib/models/thinking; what
 * is fragile here is the WIRING, which a later edit reshuffles without noticing.
 *
 * Two properties are protected:
 *  - both calls that answer the user carry it (the streaming one AND the 429
 *    retry, which is the same request minus the stream), and
 *  - it is derived from the context serving THIS round, not the conversation's.
 *    The loop escalates to a thinking-tier model on round 0 and on large
 *    prompts, and that model can be on the other provider — which spells the
 *    field `reasoning_effort` rather than `reasoning`.
 */

/** Every `client.chat.completions.create({...})` body in the file, in order. */
function createBodies(): string[] {
  const bodies: string[] = [];
  const marker = 'client.chat.completions.create(';
  let from = 0;
  for (;;) {
    const at = SRC.indexOf(marker, from);
    if (at === -1) break;
    // Walk the braces of the object literal argument so a nested `{}` (message
    // content, stream_options) doesn't end the body early.
    const open = SRC.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}' && --depth === 0) break;
    }
    bodies.push(SRC.slice(open, i + 1));
    from = i;
  }
  return bodies;
}

describe('thinking level reaches the request', () => {
  it('finds the four completion calls the loop makes', () => {
    // Opening ack, mid-task status update, the streaming answer, the 429 retry.
    // If this number changes, the split below needs revisiting rather than
    // silently covering a different set of calls.
    expect(createBodies()).toHaveLength(4);
  });

  it('carries it on both calls that produce the answer', () => {
    const answering = createBodies().filter((b) => b.includes('...(tools ? { tools } : {})'));
    expect(answering).toHaveLength(2);
    for (const body of answering) expect(body).toContain('...thinking');
  });

  it('leaves the two narration calls on the provider default', () => {
    // The opening ack and the mid-task status line write one or two casual
    // sentences about work already done. A thread set to `high` would buy them
    // nothing and delay the one thing they exist to deliver quickly.
    const narration = createBodies().filter((b) => !b.includes('...(tools ? { tools } : {})'));
    expect(narration).toHaveLength(2);
    for (const body of narration) expect(body).not.toContain('...thinking');
  });

  it('reads the model off the round’s own context, not the conversation’s', () => {
    // A persisted row can carry a codex/ id under provider 'openrouter', so the
    // round's context is coerced before it is read.
    const derived = SRC.match(/const (\w+) = coerceModelContext\((\w+)\);/);
    expect(derived, 'the round’s context is no longer coerced here').not.toBeNull();
    const [, name, source] = derived!;
    expect(source).toBe('turnCtx');

    const assignment = SRC.match(/const thinking = thinkingRequestParams\(\s*([^)]*)\)/);
    expect(assignment, 'thinking params are no longer built here').not.toBeNull();
    const args = assignment![1];
    // Provider AND model: the effort ceiling is per model on Codex, so passing
    // the provider alone silently caps a thread at xhigh on a model that goes
    // deeper — and offers a 400 on one that does not.
    expect(args).toContain(`${name}.provider`);
    expect(args).toContain(`${name}.modelId`);
    expect(args).not.toContain('baseCtx');
    expect(args).not.toContain('options.modelContext');
  });
});
