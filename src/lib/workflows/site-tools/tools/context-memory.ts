import { register, tools } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiContextProposals } from '$lib/db/schema';
import { and, eq, gt } from 'drizzle-orm';

function proposalId(args: Record<string, unknown>): string {
  return typeof args.id === 'string' ? args.id.trim() : '';
}

async function findPending(id: string) {
  const [proposal] = await db.select().from(jkaiContextProposals).where(and(
    eq(jkaiContextProposals.id, id),
    eq(jkaiContextProposals.status, 'pending'),
    gt(jkaiContextProposals.expiresAt, new Date()),
  )).limit(1);
  return proposal;
}

register({
  name: 'accept_context_proposal',
  description: 'Accept a pending JKAI context-memory proposal. Memory proposals are saved through the existing save_memory path; inferred proposals remain provisional until you accept them.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string', description: 'Optional edited wording for an accepted memory.' } }, required: ['id'] },
  category: 'Context memory', toolset: 'memory',
  handler: async (args) => {
    const proposal = await findPending(proposalId(args));
    if (!proposal) return { success: false, error: 'Pending context proposal not found or expired.' };
    const content = typeof args.content === 'string' && args.content.trim() ? args.content.trim().slice(0, 500) : proposal.content;
    if (proposal.kind === 'memory') {
      const save = tools.find((tool) => tool.name === 'save_memory');
      if (!save) return { success: false, error: 'Memory storage is unavailable.' };
      const result = await save.handler({ category: proposal.category ?? 'situations', content });
      if (!result.success) return result;
    }
    await db.update(jkaiContextProposals).set({ status: 'accepted', resolvedAt: new Date(), updatedAt: new Date() }).where(eq(jkaiContextProposals.id, proposal.id));
    return { success: true, data: { id: proposal.id, content, accepted: true } };
  },
});

register({
  name: 'resolve_context_proposal',
  description: 'Dismiss, defer, or investigate a context proposal. Investigation is read-only: it only asks JKAI to look into the item and cannot trigger an external action.',
  parameters: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: ['dismiss', 'defer', 'investigate'] } }, required: ['id', 'action'] },
  category: 'Context memory', toolset: 'memory',
  handler: async (args) => {
    const proposal = await findPending(proposalId(args));
    const action = args.action;
    if (!proposal) return { success: false, error: 'Pending context proposal not found or expired.' };
    if (action !== 'dismiss' && action !== 'defer' && action !== 'investigate') return { success: false, error: 'action must be dismiss, defer, or investigate.' };
    await db.update(jkaiContextProposals).set({ status: action === 'investigate' ? 'investigated' : action === 'defer' ? 'deferred' : 'dismissed', resolvedAt: new Date(), updatedAt: new Date() }).where(eq(jkaiContextProposals.id, proposal.id));
    return { success: true, data: { id: proposal.id, action, readOnly: action === 'investigate', prompt: action === 'investigate' ? `Investigate: ${proposal.content}` : undefined } };
  },
});
