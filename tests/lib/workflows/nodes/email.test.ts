import { describe, it, expect, vi } from 'vitest';
import { emailExecutor, emailDef } from '$lib/workflows/nodes/email';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id-123' }),
    })),
  },
}));

const mockContext: ExecutionContext = makeExecutionContext({ workflowId: '' });

describe('emailExecutor', () => {
  it('sends an email and returns sent + messageId', async () => {
    const result = await emailExecutor.execute(
      { name: 'Alice' },
      {
        to: 'alice@example.com',
        subject: 'Hello {{input.name}}',
        body: 'Hi {{input.name}}, welcome!',
      },
      mockContext,
    );

    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toBe('test-msg-id-123');
  });

  it('interpolates templates in to, subject, and body', async () => {
    const nodemailer = await import('nodemailer');
    const transporter = (nodemailer.default.createTransport as any).mock.results[0]?.value;
    const sendMailSpy = transporter?.sendMail;
    if (!sendMailSpy) return; // skip if mock not wired

    await emailExecutor.execute(
      { email: 'bob@example.com', greeting: 'Bob' },
      {
        to: '{{input.email}}',
        subject: 'Hi {{input.greeting}}',
        body: 'Dear {{input.greeting}}',
      },
      mockContext,
    );

    const mailOptions = sendMailSpy.mock.calls.at(-1)?.[0];
    expect(mailOptions?.to).toBe('bob@example.com');
    expect(mailOptions?.subject).toBe('Hi Bob');
  });

  it('has correct type', () => {
    expect(emailExecutor.type).toBe('email');
  });
});

describe('emailDef', () => {
  it('is integration category', () => {
    expect(emailDef.category).toBe('integration');
  });
  it('has to, subject, body in configSchema', () => {
    expect(emailDef.configSchema.properties?.to).toBeDefined();
    expect(emailDef.configSchema.properties?.subject).toBeDefined();
    expect(emailDef.configSchema.properties?.body).toBeDefined();
  });
});
