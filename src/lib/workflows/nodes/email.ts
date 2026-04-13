import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';

// Lazily created singleton transporter — reused across calls so mocks capture all sendMail calls
let _transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'localhost',
      port: parseInt(env.SMTP_PORT || '587'),
      secure: false,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    });
  }
  return _transporter;
}

export const emailExecutor: NodeExecutor = {
  type: 'email',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const to = interpolateTemplate((config.to as string) || '', input);
    const subject = interpolateTemplate((config.subject as string) || '', input);
    const body = interpolateTemplate((config.body as string) || '', input);
    const from = (config.from as string) || env.SMTP_FROM || 'noreply@localhost';

    if (!to) {
      return { output: { error: 'No recipient (to) configured' } };
    }

    const isHtml = body.trimStart().startsWith('<');
    const transporter = getTransporter();

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    });

    return {
      output: {
        sent: true,
        messageId: info.messageId,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in to/subject/body' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        messageId: { type: 'string' },
      },
    };
  },
};

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
};
