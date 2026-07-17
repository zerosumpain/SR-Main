import type { NodeExecutor } from '../types';

export { whatsappTriggerDef } from './whatsapp-trigger.def';

/**
 * whatsapp-trigger executor — passthrough entry point (like `trigger.ts`).
 *
 * The actual keyword matching + dispatch happens outside the engine, in the
 * WhatsApp orchestrator bridge (`whatsapp/workflow-dispatch.ts`), which fires
 * the run with initialInput `{ message, rawMessage, from, matchedKeyword }`.
 * Because this node is the workflow's root, it simply forwards that payload to
 * downstream nodes so `{{input.message}}`, `{{input.from}}`, etc. resolve.
 */
export const whatsappTriggerExecutor: NodeExecutor = {
  type: 'whatsapp-trigger',

  async execute(input: Record<string, unknown>) {
    return { output: { ...input }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'No input — the WhatsApp trigger is the workflow entry.' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The inbound text (keyword-stripped when stripKeyword is on).' },
        rawMessage: { type: 'string', description: 'The full original inbound message text.' },
        from: { type: 'string', description: 'Sender phone number / JID (the owner).' },
        matchedKeyword: { type: 'string', description: 'The keyword that routed this message here.' },
      },
    };
  },
};
