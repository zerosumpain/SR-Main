import { afterAll, expect, it } from 'vitest';
import { db } from '$lib/db';
import { jkaiEvidenceResults } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readEvidence, retainEvidence } from './evidence.server';
import { contextResult } from './evidence';
const conversationId = crypto.randomUUID();
afterAll(async () => { await db.delete(jkaiEvidenceResults).where(eq(jkaiEvidenceResults.conversationId, conversationId)); });
it('recovers omitted evidence with conversation isolation and explicit pagination', async () => {
  const retained = await retainEvidence('fixture', { success: true, data: { content: 'x'.repeat(40000), conclusion: 'end of result' } }, { emit: () => {}, conversationId });
  const clipped = JSON.parse(contextResult(retained));
  const handle = clipped.evidence.resultHandle;
  expect(handle).toBeTruthy();
  await expect(readEvidence(handle, crypto.randomUUID())).rejects.toThrow('No evidence');
  let offset = 0; let result = '';
  do {
    const page = await readEvidence(handle, conversationId, offset);
    result += page.text; offset = page.nextOffset ?? -1;
  } while (offset >= 0);
  expect(JSON.parse(result).data.conclusion).toBe('end of result');
});

it('does not retain a second evidence handle for an evidence recovery call', async () => {
  const result = { success: true, data: { text: 'already retained', resultHandle: crypto.randomUUID() } };
  expect(await retainEvidence('evidence_read', result, { emit: () => {}, conversationId })).toBe(result);
});
