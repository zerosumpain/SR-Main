import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { gmailService } from '$lib/workflows/gmail/service';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { gmailFetchDef } from './gmail-fetch.def';

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

export const gmailFetchExecutor: NodeExecutor = {
  type: 'gmail-fetch',

  async execute(input, config, context): Promise<NodeResult> {
    const acct = await loadAccount(config, input);
    const messageId = interpolateTemplateStrict(String(config.messageId ?? ''), input).result;
    if (!messageId) throw new Error('messageId is required');
    const msg = await gmailService.fetchMessage(acct, messageId);
    return { output: msg, metadata: { _selectedHandle: 'output' }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for messageId template interpolation (e.g. {{input.messageId}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        id: { type: 'string' },
        threadId: { type: 'string' },
        labelIds: { type: 'array', items: { type: 'string' } },
        snippet: { type: 'string' },
        headers: { type: 'object' },
        bodyText: { type: 'string' },
        bodyHtml: { type: 'string' },
        attachments: { type: 'array', items: { type: 'object' } },
      },
    };
  },
};
