import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { gmailService } from '$lib/workflows/gmail/service';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { gmailSendDef } from './gmail-send.def';

async function loadAccount(config: Record<string, unknown>, input: Record<string, unknown>) {
  const accountId = Number(
    (config.accountId as number | string | undefined) ??
    (input.accountId as number | string | undefined) ??
    0,
  );
  if (!accountId) throw new Error('accountId is required (in config or input)');
  const rows = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, accountId));
  const acct = rows[0];
  if (!acct) throw new Error(`Gmail account ${accountId} not found`);
  return acct;
}

export const gmailSendExecutor: NodeExecutor = {
  type: 'gmail-send',

  async execute(input, config, context): Promise<NodeResult> {
    const acct = await loadAccount(config, input);

    const interp = (tpl: string) => interpolateTemplateStrict(tpl, input).result;

    const to = interp(String(config.to ?? ''));
    const subject = interp(String(config.subject ?? ''));
    const bodyText = interp(String(config.bodyText ?? '')) || undefined;
    const bodyHtml = interp(String(config.bodyHtml ?? '')) || undefined;
    const cc = interp(String(config.cc ?? '')) || undefined;
    const bcc = interp(String(config.bcc ?? '')) || undefined;

    const result = await gmailService.sendMessage(acct, { to, subject, bodyText, bodyHtml, cc, bcc });
    return {
      output: { ...result, sent: true },
      metadata: { _selectedHandle: 'output' },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation (e.g. {{input.to}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        threadId: { type: 'string' },
        rfc822MessageId: { type: 'string' },
        sent: { type: 'boolean' },
      },
    };
  },
};
