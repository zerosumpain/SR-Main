import type { NodeDefinition } from '../types';

export const emailDef: NodeDefinition = {
  type: 'email',
  label: 'Email',
  category: 'integration',
  description: 'Send an email via SMTP. To, subject, and body support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient address. Supports {{input.field}} templates.' },
      subject: { type: 'string', description: 'Email subject. Supports templates.' },
      body: { type: 'string', description: 'Email body. HTML if it starts with <. Supports templates.' },
      from: { type: 'string', description: 'Sender override (default: SMTP_FROM env var)' },
    },
    required: ['to', 'subject', 'body'],
  },
  defaultConfig: { to: '', subject: '', body: '', from: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'to',
      label: 'Recipient',
      type: 'template-textarea',
      description: 'Who the email goes to. Supports {{input.field}} templates.',
      placeholder: 'alice@example.com',
    },
    {
      key: 'subject',
      label: 'Subject',
      type: 'template-textarea',
      description: 'Subject line. Supports templates.',
      placeholder: 'Daily report for {{input.date}}',
    },
    {
      key: 'body',
      label: 'Body',
      type: 'template-textarea',
      description: 'Email body. If it starts with an HTML tag it is sent as HTML, otherwise as plain text.',
      placeholder: 'Hi,\n\nHere is the update: {{input.summary}}',
    },
    {
      key: 'from',
      label: 'From Address',
      type: 'text',
      description: 'Override the sender address. Leave blank to use the server default (SMTP_FROM).',
      placeholder: 'noreply@example.com',
      section: 'ADVANCED',
      advancedOnly: true,
    },
  ],
  llmDescription: `Send an email via the server's SMTP transport. \`to\`, \`subject\`, and \`body\` support {{input.field}} templates. The body is sent as HTML if it starts with an HTML tag, otherwise as plain text. \`from\` defaults to the SMTP_FROM env var. Use for report/notification delivery to an inbox; use the \`whatsapp\` node for WhatsApp. Output: { success, messageId?, error? }.`,
  llmExamples: [
    { to: '{{input.email}}', subject: 'Daily report {{today}}', body: '<p>{{input.summary}}</p>' },
    { to: 'me@example.com', subject: 'Alert', body: 'Threshold exceeded: {{input.value}}' },
  ],
};
