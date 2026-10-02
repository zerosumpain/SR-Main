// src/lib/daydream/red-team.server.ts
//
// One sceptical pass over a note, after its sources were re-read. Rules and
// words in `red-team.ts`. The model is the "Daydream reviewer" workload
// (`resolveDaydreamReviewModel`), so it is changed in settings, not here.
//
// Read-only by construction: the private toolbox holds look-ups only, the
// same set the think loop has. The blast radius is one verdict on one note.

import { getLLMClient } from '$lib/llm/client';
import { runToolLoop } from '$lib/llm/tool-loop';
import { resolveDaydreamReviewModel } from '$lib/server/models/workload-settings';
import { createToolbox } from './think/tools';
import { localDay } from './features/build';
import { DEFAULT_SUBJECT } from './types';
import { loadLessons } from './lessons.server';
import { enforceRules, parseRedTeam, redTeamPrompt, type NoteUnderCheck, type RedTeamReview } from './red-team';

/** Tool rounds for the sceptic. Most money checks settle on the re-read plus
 *  one ledger look-up. */
export const RED_TEAM_ROUNDS = 3;

export interface RedTeamRun {
  review: RedTeamReview;
  tokens: { prompt: number; completion: number };
}

export async function runRedTeam(opts: {
  note: NoteUnderCheck;
  sources: Array<{ label: string; text: string }>;
  timeoutMs: number;
  now?: Date;
}): Promise<RedTeamRun> {
  const now = opts.now ?? new Date();
  const today = localDay(now);
  const toolbox = createToolbox({ set: 'private', now, day: today, subject: DEFAULT_SUBJECT });
  const [lessons, definitions, model] = await Promise.all([
    loadLessons(now).catch(() => []),
    toolbox.definitions(),
    resolveDaydreamReviewModel(),
  ]);
  const { client, model: modelId } = await getLLMClient(model);
  const seen = opts.sources.map((s) => s.text);

  const loop = await runToolLoop({
    client,
    model: modelId,
    messages: [
      { role: 'system', content: redTeamPrompt({ note: opts.note, sources: opts.sources, lessons, rounds: RED_TEAM_ROUNDS, today }) },
      { role: 'user', content: 'Try to prove the note wrong. Look if you need to, then answer with the JSON object.' },
    ],
    tools: definitions,
    maxRounds: RED_TEAM_ROUNDS,
    temperature: 0.2,
    maxTokens: 1800,
    activity: 'daydream-review',
    timeoutMs: opts.timeoutMs,
    forceFinal: { prompt: 'No more tools. Answer now with the JSON object only.', temperature: 0.1 },
    execute: async (call) => {
      const outcome = await toolbox.call(call.name, call.args);
      if (!outcome.failed) seen.push(outcome.content);
      return outcome.content;
    },
  });

  const parsed = parseRedTeam(loop.reply);
  const base = parsed ?? {
    verdict: 'unclear' as const,
    claim: '',
    challenges: [],
    reasoning: 'The second look did not come back with a usable answer, so this note is neither confirmed nor ruled out.',
    lesson: null,
  };
  const ruled = enforceRules(base, { note: opts.note, seen });
  return {
    review: { ...base, ...ruled, lesson: ruled.verdict === 'wrong' ? base.lesson : null, model: modelId, checkedAt: new Date().toISOString() },
    tokens: { ...loop.usage },
  };
}
