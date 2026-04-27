import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { gmailService } from '$lib/workflows/gmail/service';
import { db } from '$lib/db';
import { gmailAccounts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { gmailLabelDef } from './gmail-label.def';

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

export const gmailLabelExecutor: NodeExecutor = {
  type: 'gmail-label',

  async execute(input, config, context): Promise<NodeResult> {
    const messageId = interpolateTemplateStrict(String(config.messageId ?? ''), input).result;
    if (!messageId) throw new Error('messageId is required');

    const add = (config.add as string[] | undefined) ?? [];
    const remove = (config.remove as string[] | undefined) ?? [];

    if (context.dryRun) {
      const accountId = Number(
        (config.accountId as number | string | undefined) ??
        (input.accountId as number | string | undefined) ??
        0,
      );
      return {
        output: {
          simulated: true,
          would_label: { accountId, messageId, addLabels: add, removeLabels: remove },
        },
        rowCount: 1,
        logs: [`[dry-run] would modify labels on Gmail message ${messageId}: +${add.join(',')} -${remove.join(',')}`],
      };
    }

    const acct = await loadAccount(config, input);

    await gmailService.modifyLabels(acct, messageId, add, remove);

    return {
      output: { ok: true, messageId, added: add, removed: remove },
      metadata: { _selectedHandle: 'output' },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for messageId template interpolation (e.g. {{input.messageId}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        messageId: { type: 'string' },
        added: { type: 'array', items: { type: 'string' } },
        removed: { type: 'array', items: { type: 'string' } },
      },
    };
  },
};
