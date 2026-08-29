import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const ROUTE = read('src/routes/api/workflows/orchestrator/chat/+server.ts');
const CHAT = read('src/lib/workflows/chat/general-chat.ts');
const SUBAGENT = read('src/lib/workflows/chat/sub-agent.ts');
const FOLLOWUP = read('src/lib/workflows/chat/followup-queue.ts');

/**
 * The model picker claims to set the model for a session. It only does that if
 * the pin travels the whole way — and the whole way is four hops, in three
 * files, none of which fails loudly when a hop is dropped.
 *
 * These are source assertions for the same reason `thinking-level-wiring` is:
 * proving it at runtime means standing up a DB, a SvelteKit request context and
 * the site toolsets to observe one field being handed along. The behaviour that
 * can be tested properly IS — see `the session pin` in
 * `src/lib/server/models/workload-settings.test.ts`, which exercises the real
 * capability gate. What is fragile here is the plumbing, which a later edit
 * reshuffles without noticing, and whose failure mode is silence: the reply
 * still comes back on the right model, and everything behind it quietly does not.
 */
describe('session model wiring', () => {
  it('only pins the session when the OWNER chose the model', () => {
    // The whole safety argument. Every thread carries a model — creation stamps
    // the site default when the composer names none — so propagating on the
    // model alone would drag whatever was default months ago into today's
    // builds and OCR. `model_pinned_by_user` is what separates a choice from a
    // stamp, and this is the only place the route reads it.
    expect(ROUTE).toMatch(/if\s*\(conv\.modelPinnedByUser\)\s*sessionModel\s*=\s*modelContext/);
    // Declared null, so a conversation row that fails to load cannot leave a
    // stale pin from an earlier iteration of the handler.
    expect(ROUTE).toMatch(/let sessionModel: ModelContext \| null = null/);
  });

  it('hands the pin to generalChat, distinct from the model that answers', () => {
    // modelContext and sessionModel are deliberately two fields: the first
    // always answers the reply, the second decides whether anything else
    // follows. Collapsing them would re-pin every unpinned thread.
    expect(ROUTE).toMatch(/modelContext,\n\s+sessionModel,/);
  });

  it('puts the pin on the ambient store so nested calls inherit it', () => {
    // Recall, compaction, memory review, research and OCR are all several
    // frames below the code that knows a chat exists. AsyncLocalStorage is how
    // they see it without every signature in between learning about chat.
    expect(CHAT).toMatch(/sessionModel:\s*options\.sessionModel\s*\?\?\s*undefined/);
  });

  it('hands the pin to tools whose work outlives the turn', () => {
    // A build runs for up to an hour in a sidecar with no async context, so the
    // ambient store cannot reach it — the model has to be written onto its row
    // while the turn is still alive. Both toolCtx branches carry it, because the
    // jobless branch is the one the follow-up queue and the WhatsApp bridge use.
    expect(CHAT.match(/modelContext: sessionModel,/g) ?? []).toHaveLength(2);
  });

  it('carries the thinking level with the model, not separately', () => {
    // A thread turned up to `high` that farms half its work out to a sub-agent
    // running on the provider default has not been turned up at all. Gated on
    // the pin so an unpinned thread's tools keep their previous behaviour.
    expect(CHAT).toMatch(/sessionThinkingLevel:\s*options\.sessionModel\s*\?/);
    expect(SUBAGENT).toMatch(/sessionModel:\s*session\?\.sessionModel\s*\?\?\s*null/);
    expect(SUBAGENT).toMatch(/thinkingLevel:\s*session\?\.thinkingLevel\s*\?\?\s*null/);
  });

  it('resumes a follow-up on the same pin', () => {
    // A delivery is the same session resuming. Without this it would answer on
    // the thread's model and run its tools on the site default — the exact split
    // the pin exists to close, reappearing on the one turn nobody is watching.
    expect(FOLLOWUP).toMatch(/if\s*\(conv\.modelPinnedByUser\)\s*sessionModel\s*=\s*modelContext/);
    expect(FOLLOWUP).toMatch(/sessionModel,\n\s+thinkingLevel,/);
  });
});
