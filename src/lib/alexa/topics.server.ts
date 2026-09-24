// Filing each utterance under one topic from a fixed list.
//
// Mechanical labelling against a closed vocabulary, so it takes the extraction
// role's model (the cheap fast one) and is tagged `extraction` for the spend
// ledger — the same pairing the mail-rule proposer uses. A household says a few
// dozen things to Alexa a day, so a batch of 80 short lines a night is a
// fraction of a penny.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { alexaUtterances } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { withActivity } from '$lib/context/activity';
import { resolveExtractionModel } from '$lib/server/models/workload-settings';
import { untaggedUtterances } from './store.server';
import { parseTopicReply, topicPrompt, TOPIC_SYSTEM } from './topics';

export interface TagResult {
  considered: number;
  tagged: number;
  tokens: number;
  remaining: boolean;
}

export async function tagUtteranceTopics(opts: { batch?: number; batches?: number } = {}): Promise<TagResult> {
  const batch = opts.batch ?? 80;
  const batches = opts.batches ?? 5;
  const result: TagResult = { considered: 0, tagged: 0, tokens: 0, remaining: false };
  const { client, model } = await getLLMClient(await resolveExtractionModel());

  for (let i = 0; i < batches; i++) {
    const rows = await untaggedUtterances(batch);
    if (rows.length === 0) return result;
    result.considered += rows.length;

    const res = await withActivity('extraction', () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: TOPIC_SYSTEM },
          { role: 'user', content: topicPrompt(rows) },
        ],
        temperature: 0,
        max_tokens: 3000,
      }),
    );
    result.tokens += (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);
    const topics = parseTopicReply(res.choices[0]?.message?.content ?? '', rows);
    for (const [id, topic] of topics) {
      await db.update(alexaUtterances).set({ topic }).where(eq(alexaUtterances.id, id));
    }
    result.tagged += topics.size;
    // A batch the model returned nothing usable for would be offered again
    // next loop, identically; stop and let the next night try.
    if (topics.size === 0) {
      result.remaining = true;
      return result;
    }
  }
  result.remaining = (await untaggedUtterances(1)).length > 0;
  return result;
}
