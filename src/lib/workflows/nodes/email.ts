import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';

export { emailDef } from './email.def';

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

