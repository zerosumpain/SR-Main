import type { NodeDefinition } from '../types';

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
  summarize: (config) => {
    const to = String(config.to ?? '').trim();
    const message = String(config.message ?? '').trim();
    const short = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    return {
      line: to ? `Send a WhatsApp message to ${to}` : 'Send a WhatsApp message (set a recipient first)',
      preview: { kind: 'message', details: { To: to || '—', Message: short || '—' } },
    };
  },
  basicConfig: [
    {
      key: 'to',
      label: 'Recipient Phone Number',
      type: 'template-textarea',
      placeholder: '+447359228511 or {{input.phone}}',
      description: 'Phone number in E.164 format (include country code). Supports {{input.field}} templates.',
    },
    {
      key: 'message',
      label: 'Message',
      type: 'template-textarea',
      placeholder: 'Hi {{input.name}}, your report is ready.',
      description: 'Text to send. Supports {{input.field}} templates.',
    },
  ],
  llmDescription: `Send a WhatsApp message to a phone number. Use this node when a workflow needs to notify someone via WhatsApp.

IMPORTANT: Downstream nodes access this node's result as \`input.sent\`, \`input.messageId\`, or \`input.error\` (the upstream output is merged directly into the downstream input).

The \`to\` field must be an E.164 phone number (e.g., "+447359228511"). Both \`to\` and \`message\` support template interpolation with \`{{input.field}}\` syntax.

Requires an active WhatsApp connection (configured via the WhatsApp settings in the workflows UI).`,
  llmExamples: [
    { to: '+447359228511', message: 'Daily report: {{input.summary}}' },
    { to: '{{input.phone}}', message: '{{input.notification}}' },
  ],
};
