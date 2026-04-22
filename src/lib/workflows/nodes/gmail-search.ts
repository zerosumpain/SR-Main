import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { gmailService } from '$lib/workflows/gmail/service';
import type { GmailMessage } from '$lib/workflows/gmail/types';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { gmailSearchDef } from './gmail-search.def';

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

export const gmailSearchExecutor: NodeExecutor = {
  type: 'gmail-search',

  async execute(input, config, context): Promise<NodeResult> {
    const acct = await loadAccount(config, input);

    const query = interpolateTemplateStrict(String(config.query ?? ''), input).result;
    const maxResults = Number(config.maxResults ?? 50);
    const fetchFull = Boolean(config.fetchFullMessages);

    const messageIds = await gmailService.listMessages(acct, query, maxResults);

    let messages: GmailMessage[] | undefined;
    if (fetchFull) {
      messages = await Promise.all(messageIds.map((id) => gmailService.fetchMessage(acct, id)));
    }

    const output: Record<string, unknown> = {
      count: messageIds.length,
      messageIds,
    };
    if (messages !== undefined) {
      output.messages = messages;
    }

    return {
      output,
      metadata: { _selectedHandle: 'output' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for query template interpolation (e.g. {{input.q}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        count: { type: 'number' },
        messageIds: { type: 'array', items: { type: 'string' } },
        messages: { type: 'array', items: { type: 'object' } },
      },
    };
  },
};
