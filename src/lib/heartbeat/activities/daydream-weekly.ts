import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import {
  gatherWeek,
  numericStats,
  isLocalSunday,
  localDayStr,
  phraseWeek,
  saveWeekly,
  weekFactLines,
  weeklyRowExists,
} from '$lib/daydream/digest/weekly';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-weekly';

/**
 * The Sunday letter: what the engine noticed, tried, got wrong, and wants to
 * watch next — model-written from the counted facts only, verified at
 * temperature 0, and shipped with the deterministic summary either way. A
 * quiet week is reported as a quiet week.
 *
 * Sent over WhatsApp directly, OUTSIDE the 4-a-day thought cap: those limits
 * ration interruptions the owner did not ask for, and a once-a-week scheduled
 * letter is correspondence he did — the same standing the morning briefing
 * has. One a week, deduped on the digest row.
 */
export const daydreamWeekly: ActivityHandler = {
  name: NAME,
  description:
    "Sunday's weekly letter: deterministic counts of the week (thoughts, feedback, verdicts, leads, spend, audit drops) with a model narrative composed from those counts only and verified at temperature 0. Delivered over WhatsApp outside the daily thought cap. Spends against the Codex caps.",
  defaultCadenceSeconds: 6 * 3600,
  defaultActiveHours: { start: '17:00', end: '21:00', tz: 'Europe/London' },
  defaultEnabled: true,
  defaultConfig: {},

  async run(ctx) {
    const now = new Date(ctx.now);

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }
    if (!isLocalSunday(now)) {
      return { outcome: 'skipped', summary: 'not Sunday — the letter is weekly' };
    }
    const day = localDayStr(now);
    if (await weeklyRowExists(day)) {
      return { outcome: 'skipped', summary: `week to ${day} already written` };
    }

    const facts = await gatherWeek(now);
    const summary = phraseWeek(facts);
    const factLines = weekFactLines(facts);

    // ── Narrative: model prose over the counted facts, or nothing ──
    let narrative: string | null = null;
    let verified: boolean | null = null;
    let quota = { ...ZERO_SPEND };
    let promptTokens = 0;
    let completionTokens = 0;

    const model = await resolveDaydreamModel();
    const isCodexModel = model.provider === 'codex';
    const budget = await budgetStatus({ now, isCodexModel });

    if (!budget.blocked) {
      const before = isCodexModel ? await readQuotaMark() : null;
      try {
        const { getLLMClient } = await import('$lib/llm/client');
        const { client, model: modelId } = await getLLMClient(model);

        const res = await client.chat.completions.create({
          model: modelId,
          temperature: 0.5,
          max_tokens: 400,
          messages: [
            {
              role: 'system',
              content:
                "Write John's weekly second-brain letter: 2-4 plain sentences over the FACTS below — what the week held, what was learned or refuted, what deserves watching next. Every number and claim must appear in the facts; a quiet week is stated as quiet, never padded. No greeting, no sign-off, no emoji.",
            },
            { role: 'user', content: `FACTS:\n${factLines.join('\n')}` },
          ],
        });
        promptTokens += res.usage?.prompt_tokens ?? 0;
        completionTokens += res.usage?.completion_tokens ?? 0;
        const draft = (res.choices[0]?.message?.content ?? '').trim();

        if (draft && draft.length <= 900) {
          const check = await client.chat.completions.create({
            model: modelId,
            temperature: 0,
            max_tokens: 10,
            messages: [
              {
                role: 'system',
                content:
                  'Answer with exactly one word. SUPPORTED if every claim and number in the draft appears in the facts; otherwise UNSUPPORTED. Default to UNSUPPORTED when unsure.',
              },
              { role: 'user', content: `FACTS:\n${factLines.join('\n')}\n\nDRAFT:\n${draft}` },
            ],
          });
          promptTokens += check.usage?.prompt_tokens ?? 0;
          completionTokens += check.usage?.completion_tokens ?? 0;
          const word = (check.choices[0]?.message?.content ?? '').trim().toUpperCase();
          verified = word.startsWith('SUPPORTED');
          // UNSUPPORTED prose is dropped whole — the summary carries the week.
          narrative = verified ? draft : null;
        }
      } catch {
        narrative = null;
      }
      const after = isCodexModel ? await readQuotaMark() : null;
      quota = isCodexModel ? attributeSpend(before, after) : { ...ZERO_SPEND };
    }

    await saveWeekly(day, summary, narrative, verified, numericStats(facts));

    // ── Deliver: WhatsApp first, chat note as the floor ──
    let channel = 'none';
    try {
      const { ownerPhone } = await import('$lib/config/owner');
      const to = ownerPhone();
      if (to) {
        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        const message =
          `🗞 *The week, according to your second brain*\n\n${narrative ?? summary}` +
          (narrative ? `\n\n_${summary}_` : '') +
          `\n\nhttps://strangeramblings.com/jkai/daydreams/discoveries`;
        const res = await executeTool('whatsapp_send', { to, message: message.slice(0, 1200) });
        if (res?.success) channel = 'whatsapp';
      }
      if (channel === 'none') {
        const { latestConversationId } = await import('$lib/daydream/deliver');
        const conversationId = await latestConversationId();
        if (conversationId) {
          const { postHeartbeatNote } = await import('$lib/heartbeat/llm');
          await postHeartbeatNote({
            conversationId,
            text: `**The week, according to your second brain**\n\n${narrative ?? summary}`,
            activityName: NAME,
          });
          channel = 'chat';
        }
      }
    } catch (err) {
      return {
        outcome: 'error',
        summary: `written but not delivered: ${errMsg(err)}`,
        details: { quota, day, summary, narrative: narrative != null, verified },
      };
    }

    return {
      outcome: 'ok',
      summary: `week to ${day} → ${channel}${narrative ? ' with verified narrative' : verified === false ? ' (narrative dropped: UNSUPPORTED)' : ' (summary only)'}`,
      promptTokens,
      completionTokens,
      details: {
        // Load-bearing: budget.ts reads this key back to enforce the caps.
        quota,
        day,
        channel,
        verified,
        facts,
      },
    };
  },
};
