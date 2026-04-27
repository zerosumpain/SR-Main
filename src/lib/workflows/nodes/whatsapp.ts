import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getWhatsAppService } from '../whatsapp/service';

export { whatsappDef } from './whatsapp.def';

export const whatsappExecutor: NodeExecutor = {
  type: 'whatsapp',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const to = interpolateTemplate((config.to as string) || '', input);
    const message = interpolateTemplate((config.message as string) || '', input);

    if (!to) {
      return { output: { sent: false, error: 'No recipient (to) configured' }, rowCount: 1 };
    }

    if (!message) {
      return { output: { sent: false, error: 'No message content configured' }, rowCount: 1 };
    }

    const service = getWhatsAppService();
    const result = await service.sendMessage(to, message);

    return {
      output: {
        sent: result.sent,
        messageId: result.messageId || null,
        error: result.error || null,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in to/message fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        messageId: { type: 'string' },
        error: { type: 'string' },
      },
    };
  },
};

