import { register } from '../registry-internal';
import { readEvidence } from '$lib/jkai/grounding/evidence.server';
register({ name: 'evidence_read', description: 'Read the original evidence behind a resultHandle in this conversation. Page with nextOffset; retrievedAt is observation time, not event time.',
  category: 'Evidence', toolset: 'discovery',
  parameters: { type: 'object', properties: { resultHandle: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['resultHandle'] },
  handler: async (args, ctx) => {
    if (!ctx?.conversationId) return { success: false, error: 'Evidence retrieval requires a conversation scope' };
    return { success: true, data: await readEvidence(String(args.resultHandle), ctx.conversationId, Number(args.offset) || 0) };
  },
});
