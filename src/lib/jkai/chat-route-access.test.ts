import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeIdsFor } from '$lib/access/catalogue';

/**
 * Every chat route the catalogue opens to members resolves the thread (or the
 * job) through the chat guard — the same precondition intel's route-scope.test
 * and research's route-access.test hold their areas to.
 *
 * And the owner-only chat surfaces are never listed: the context rail and its
 * drill read the owner's health, places, research and memory; the thread graph
 * and memory panels are the owner's intel and memory; traces and routing are
 * the owner's operational view; the canvas chat history is a workflow's.
 */
const GUARDED = /\b(requireConversation|requireOwnJob|chatAccess|conversationListScope)\b/;

const NEVER_OPEN = [
  '/api/jkai/conversations/[id]/graph',
  '/api/jkai/conversations/[id]/context-panel',
  '/api/jkai/conversations/[id]/context-panel/drill',
  '/api/jkai/conversations/[id]/memory',
  '/api/jkai/trace/[traceId]',
  '/api/jkai/trace/[traceId]/analyse',
  '/api/jkai/routing/resolve',
  '/api/jkai/routing/feedback',
  '/api/jkai/routing/overrides',
  '/api/workflows/orchestrator/chat/[workflowId]',
];

function fileFor(routeId: string): string {
  const dir = `src/routes${routeId}`;
  if (existsSync(`${dir}/+server.ts`)) return `${dir}/+server.ts`;
  return `${dir}/+page.server.ts`;
}

describe('jkai chat routes a member can reach are guarded', () => {
  const ids = routeIdsFor('jkai.chat');

  it('calls the chat guard from every one', () => {
    const unguarded = ids.filter((id) => !GUARDED.test(readFileSync(fileFor(id), 'utf8')));
    expect(unguarded).toEqual([]);
  });

  it('never opens the owner-only chat surfaces', () => {
    for (const id of NEVER_OPEN) expect(ids, id).not.toContain(id);
  });
});
