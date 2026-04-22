import type { NodeDefinition } from '../types';

export const gmailReplyDef: NodeDefinition = {
  type: 'gmail-reply',
  category: 'integration',
  label: 'Gmail — Reply to Message',
  description: 'Send a reply to an existing Gmail thread, preserving In-Reply-To and References headers for proper threading.',
  defaultConfig: {
    accountId: 0,
    to: '{{input.from}}',
    threadId: '{{input.threadId}}',
    inReplyTo: '{{input.rfc822MessageId}}',
    references: '',
    subject: '{{input.subject}}',
    bodyText: '',
    bodyHtml: '',
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Send result' }],
  configSchema: {
    type: 'object',
    required: ['accountId', 'to', 'threadId', 'inReplyTo', 'subject'],
    properties: {
      accountId: { type: 'number', description: 'Gmail account row id' },
      to: { type: 'string', description: 'Recipient address. Defaults to {{input.from}} (supports {{input.x}})' },
      threadId: { type: 'string', description: 'Gmail thread id to reply in (supports {{input.x}})' },
      inReplyTo: { type: 'string', description: 'RFC 822 Message-ID of the message being replied to (supports {{input.x}})' },
      references: { type: 'string', description: 'References header — defaults to inReplyTo value if empty (supports {{input.x}})' },
      subject: { type: 'string', description: 'Subject line (supports {{input.x}})' },
      bodyText: { type: 'string', description: 'Plain-text body (supports {{input.x}})' },
      bodyHtml: { type: 'string', description: 'HTML body (supports {{input.x}})' },
    },
  },
};
