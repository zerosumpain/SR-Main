import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getWhatsAppService } from '../whatsapp/service';

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
      return { output: { sent: false, error: 'No recipient (to) configured' } };
    }

    if (!message) {
      return { output: { sent: false, error: 'No message content configured' } };
    }

    const service = getWhatsAppService();
    const result = await service.sendMessage(to, message);

    return {
      output: {
        sent: result.sent,
        messageId: result.messageId || null,
        error: result.error || null,
      },
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

export const whatsappDef: NodeDefinition = {
  type: 'whatsapp',
  label: 'WhatsApp',
  category: 'integration',
  description: 'Send a WhatsApp message. To and message fields support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient phone number (E.164 format). Supports {{input.field}} templates.' },
      message: { type: 'string', description: 'Message text. Supports {{input.field}} templates.' },
    },
    required: ['to', 'message'],
  },
  defaultConfig: { to: '', message: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'to',
      label: 'To (Phone Number)',
      type: 'text',
      placeholder: '+447359228511 or {{input.output.phone}}',
      description: 'E.164 format. Supports template interpolation.',
    },
    {
      key: 'message',
      label: 'Message',
      type: 'template-textarea',
      placeholder: 'Hi {{input.output.name}}, your report is ready.',
      description: 'Message text. Supports {{input.field}} templates.',
    },
  ],
  llmDescription: `Send a WhatsApp message to a phone number. Use this node when a workflow needs to notify someone via WhatsApp.

IMPORTANT: The output is wrapped in an \`output\` object. Downstream nodes should access \`input.output.sent\`, \`input.output.messageId\`, or \`input.output.error\`.

The \`to\` field must be an E.164 phone number (e.g., "+447359228511"). Both \`to\` and \`message\` support template interpolation with \`{{input.field}}\` syntax.

Requires an active WhatsApp connection (configured via the WhatsApp settings in the workflows UI).`,
  llmExamples: [
    { to: '+447359228511', message: 'Daily report: {{input.output.summary}}' },
    { to: '{{input.output.phone}}', message: '{{input.output.notification}}' },
  ],
};
