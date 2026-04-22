import type { NodeDefinition } from '../types';

export const gmailSendDef: NodeDefinition = {
  type: 'gmail-send',
  category: 'integration',
  label: 'Gmail — Send Message',
  description: 'Compose and send a new Gmail message. Supports template interpolation for recipient, subject, and body.',
  defaultConfig: {
    accountId: 0,
    to: '',
    subject: '',
    bodyText: '',
    bodyHtml: '',
    cc: '',
    bcc: '',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Send result' }],
  configSchema: {
    type: 'object',
    required: ['accountId', 'to', 'subject'],
    properties: {
      accountId: { type: 'number', description: 'Gmail account row id' },
      to: { type: 'string', description: 'Recipient address (supports {{input.x}})' },
      subject: { type: 'string', description: 'Subject line (supports {{input.x}})' },
      bodyText: { type: 'string', description: 'Plain-text body (supports {{input.x}})' },
      bodyHtml: { type: 'string', description: 'HTML body (supports {{input.x}})' },
      cc: { type: 'string', description: 'CC address(es)' },
      bcc: { type: 'string', description: 'BCC address(es)' },
    },
  },
};
