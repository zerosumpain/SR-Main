import { getSetting } from '$lib/server/models/settings';
import {
  attributeSpend,
  budgetStatus,
  readQuotaMark,
  ZERO_SPEND,
} from '$lib/daydream/budget';
import { resolveDaydreamModel } from '$lib/daydream/compose';
import {
  gatherLandgrabWeek,
  isLocalSunday,
  landgrabWeeklyExists,
  localDayStr,
  numericStats,
  phraseLandgrabWeek,
  saveLandgrabWeekly,
  weekFactLines,
} from '$lib/geo/weekly';
import { errMsg } from '$lib/daydream/types';
import { GEO_SETTINGS_ENABLED_KEY } from './geo-territory';
import type { ActivityHandler } from '../types';
import { withActivity } from '$lib/context/activity';

const NAME = 'landgrab-weekly';

interface LandgrabWeeklyConfig {
  /** Gather and phrase the week, return it, save nothing and send nothing.
   *  The dry run — see the branch in `run` for why it sits above the gates. */
  preview?: boolean;
}

/**
 * The landgrab Sunday letter: who gained ground, who lost it, who took what
 * off whom, and the week's biggest claim — counted off the ledger, phrased
 * deterministically, and optionally narrated by a model that may only draw on
 * those counts and is checked at temperature 0 before a word of it ships.
 *
 * Modelled line for line on `daydream-weekly`, including the bargain that
 * matters: the deterministic summary is saved and sent whether or not the
 * narrative survives verification, so a quiet week still reports as a quiet
 * week. Sent over WhatsApp directly, outside the daily thought cap — a
 * once-a-week scheduled letter is correspondence the owner asked for. One a
 * week, deduped on the digest row.
 */
export const landgrabWeekly: ActivityHandler = {
  name: NAME,
  description:
    "Sunday's landgrab letter: deterministic counts of the week's territory (holds, gains, losses, takes, the biggest claim, contested share, the battleground) with a model narrative composed from those counts only and verified at temperature 0. Delivered over WhatsApp, chat note as the floor. Spends against the Codex caps.",
  defaultCadenceSeconds: 6 * 3600,
  defaultActiveHours: { start: '17:00', end: '21:00', tz: 'Europe/London' },
  defaultEnabled: true,
  defaultConfig: { preview: false },

  async run(ctx) {
    const now = new Date(ctx.now);
    const cfg = (ctx.config ?? {}) as LandgrabWeeklyConfig;

    // Unset/null means enabled, as `geo-territory` reads the same key. Only an
    // explicit `false` is a kill switch.
    const enabled = await getSetting<boolean>(GEO_SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'geo disabled' };
    }

    // The battleground of the week is the one geocode this run makes, and the
    // gather calls it at most once. A failure names the place by coordinates
    // rather than losing the whole letter.
    const nameFor = async (centre: [number, number]): Promise<string | null> => {
      try {
        const { suggestPlaceName } = await import('$lib/daydream/geocode');
        return (await suggestPlaceName(centre[0], centre[1])).name;
      } catch {
        return null;
      }
    };

    // PREVIEW SITS ABOVE BOTH GATES, deliberately, and above them both for the
    // same reason: it is the dry run used to verify the letter the day BEFORE
    // it sends. Gated on Sunday it could only be taken on the day the real one
    // goes out, which verifies nothing; gated on the dedupe row it would go
    // dark for the rest of the day the moment the letter was written. It saves
    // nothing and sends nothing, so neither gate is protecting anything here.
    if (cfg.preview) {
      const facts = await gatherLandgrabWeek(now, nameFor);
      const summary = phraseLandgrabWeek(facts);
      return {
        outcome: 'ok',
        summary: `preview: ${summary.slice(0, 160)}`,
        details: { preview: true, day: localDayStr(now), facts, summary },
      };
    }

    if (!isLocalSunday(now)) {
      return { outcome: 'skipped', summary: 'not Sunday — the letter is weekly' };
    }
    const day = localDayStr(now);
    if (await landgrabWeeklyExists(day)) {
      return { outcome: 'skipped', summary: `week to ${day} already written` };
    }

    const facts = await gatherLandgrabWeek(now, nameFor);
    const summary = phraseLandgrabWeek(facts);
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

        // Tagged `daydream`, the role whose model this resolves. Without it the
        // heartbeat engine's own tag applies — the ACTIVITY's name, which is not
        // a workload id, so the spend lands on a row nothing can switch.
        const res = await withActivity('daydream', () =>
          client.chat.completions.create({
            model: modelId,
            temperature: 0.5,
            max_tokens: 400,
            messages: [
              {
                role: 'system',
                content:
                  "Write the household's landgrab letter: 2–4 plain sentences over the FACTS below — who gained ground, who lost it, who took what off whom, and the week's biggest claim. Every number and name must appear in the facts; a quiet week is stated as quiet, never padded. No greeting, no sign-off, no emoji.",
              },
              { role: 'user', content: `FACTS:\n${factLines.join('\n')}` },
            ],
          }),
        );
        promptTokens += res.usage?.prompt_tokens ?? 0;
        completionTokens += res.usage?.completion_tokens ?? 0;
        const draft = (res.choices[0]?.message?.content ?? '').trim();

        if (draft && draft.length <= 900) {
          const check = await withActivity('daydream', () =>
            client.chat.completions.create({
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
            }),
          );
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

    await saveLandgrabWeekly(day, summary, narrative, verified, numericStats(facts));

    // ── Deliver: WhatsApp first, chat note as the floor ──
    let channel = 'none';
    try {
      const { ownerPhone } = await import('$lib/config/owner');
      const to = ownerPhone();
      if (to) {
        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        // The 1200-character cap is WhatsApp's, and a `slice` of the whole
        // message took the LINK off the end first — the one part of the
        // letter that cannot be reconstructed. So the PROSE is what gets
        // trimmed, to whatever room the header and the link leave it.
        const header = `🏁 *Landgrab — the week*\n\n`;
        const body = (narrative ?? summary) + (narrative ? `\n\n_${summary}_` : '');
        const link = `\n\nhttps://strangeramblings.com/projects/landgrab`;
        const message = header + body.slice(0, 1200 - header.length - link.length) + link;
        const res = await executeTool('whatsapp_send', { to, message });
        if (res?.success) channel = 'whatsapp';
      }
      if (channel === 'none') {
        const { latestConversationId } = await import('$lib/daydream/deliver');
        const conversationId = await latestConversationId();
        if (conversationId) {
          const { postHeartbeatNote } = await import('$lib/heartbeat/llm');
          await postHeartbeatNote({
            conversationId,
            text: `**Landgrab — the week**\n\n${narrative ?? summary}`,
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
