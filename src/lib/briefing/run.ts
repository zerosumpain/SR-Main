// Briefing pipeline: gather → synthesise (LLM) → store → deliver. Simpler than
// the self-improve run loop (one synthesis, no budget phases) but shares the
// gates/dogfooding pattern. Single-flight guard prevents overlap.
import { randomUUID } from 'crypto';
import { ensureCollection, upsertRecord } from '$lib/datastore';
import { getSetting, resolveDefaultModel } from '$lib/server/models/settings';
import { gatherBriefingSignals, type BriefingSignals } from './gather';
import {
  BRIEFINGS_COLLECTION,
  BRIEFING_PERMS,
  SYSTEM_ACTOR,
  OWNER_PHONE,
  SETTINGS_ENABLED_KEY,
  SETTINGS_TOPICS_KEY,
  asData,
  errMsg,
  briefingDateLabel,
  type BriefingData,
} from './types';

const ADMIN_LINK = 'https://strangeramblings.com/jkai/briefing';

let running = false;
export function isBriefingRunning(): boolean {
  return running;
}

export async function ensureBriefingsCollection(): Promise<void> {
  await ensureCollection(
    BRIEFINGS_COLLECTION,
    { name: 'Briefings', description: 'Personalised briefings', isSystem: true, defaultPermissions: BRIEFING_PERMS },
    SYSTEM_ACTOR,
  );
}

function buildPrompt(signals: BriefingSignals, topics: string[], feedbackLine = ''): string {
  const parts: string[] = [];
  if (topics.length) parts.push(`The user has told me they care about these topics: ${topics.join(', ')}.`);
  if (feedbackLine) parts.push(feedbackLine);
  if (signals.insights?.intents.length) {
    parts.push(
      'Recurring things they ask about (intent · count):\n' +
        signals.insights.intents.map((i) => `- ${i.intent} · ${i.count}${i.missingCapability ? ` (gap: ${i.missingCapability})` : ''}`).join('\n'),
    );
  }
  if (signals.insights?.topUnmet.length) parts.push(`Unmet needs I have noticed: ${signals.insights.topUnmet.join('; ')}.`);
  if (signals.recentResearch.length) parts.push('Recent research sessions:\n' + signals.recentResearch.map((r) => `- ${r.topic} (${r.status})`).join('\n'));
  if (signals.recentQuestions.length) parts.push('What they asked in the last 24h:\n' + signals.recentQuestions.slice(0, 12).map((q) => `- ${q}`).join('\n'));
  const walk = (signals.siteSignals.walk as { active?: boolean } | null) ?? null;
  if (walk?.active) parts.push('They are currently out on a walk/ride.');
  if (!parts.length) parts.push('There is little recent signal — keep the briefing short and offer a couple of proactive suggestions.');
  return (
    parts.join('\n\n') +
    '\n\nWrite the briefing now: a short scannable markdown digest (a one-line greeting, then 2–4 sections with headers, then a short "worth doing today" list). ' +
    'Focus on what they care about, surface anything notable, and be specific. No filler, no invented facts.'
  );
}

async function synthesise(signals: BriefingSignals, topics: string[]): Promise<{ markdown: string; llmCalls: number; costUsd: number }> {
  const ctx = await resolveDefaultModel();
  const { getLLMClient } = await import('$lib/jkai/llm-client');
  const { client, model } = await getLLMClient(ctx);

  // Engagement weighting (👍/👎 votes) — best-effort, '' when no signal.
  let feedbackLine = '';
  try {
    const { listVotes, feedbackPromptLine } = await import('./feedback');
    feedbackLine = feedbackPromptLine(await listVotes());
  } catch {
    /* feedback is optional */
  }

  const system =
    'You are the user\'s personal chief-of-staff writing their briefing. Be concise, warm, and useful. ' +
    'Output GitHub-flavoured markdown only — no preamble, no code fences around the whole thing.';

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildPrompt(signals, topics, feedbackLine) },
    ],
    max_tokens: 2000,
    temperature: 0.4,
  });

  const markdown = resp.choices[0]?.message?.content?.trim() || '(no briefing generated)';
  const tin = resp.usage?.prompt_tokens ?? 0;
  const tout = resp.usage?.completion_tokens ?? 0;
  let costUsd = 0;
  try {
    const { priceFor, computeCost } = await import('$lib/jkai/llm-pricing');
    const price = priceFor('openrouter', resp.model || model);
    if (price) costUsd = computeCost(price, tin, tout);
  } catch {
    /* pricing is best-effort */
  }
  return { markdown, llmCalls: 1, costUsd };
}

async function persist(data: BriefingData): Promise<void> {
  await upsertRecord(BRIEFINGS_COLLECTION, { key: data.id, data: asData(data) }, SYSTEM_ACTOR);
}

async function notify(data: BriefingData): Promise<void> {
  const firstLine = data.markdown.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '') ?? data.title;
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const msg = `☕ ${data.title}\n${firstLine.slice(0, 400)}\n${ADMIN_LINK}`;
    await executeTool('whatsapp_send', { to: OWNER_PHONE, message: msg.slice(0, 600) });
  } catch (err) {
    console.error('[briefing] whatsapp notify failed:', errMsg(err));
  }
  // Web push too — the tap-to-open-the-PWA channel (deep-links /jkai/briefing).
  // Independent of the WhatsApp path; both are best-effort.
  try {
    const { notifyAllSubscribers } = await import('$lib/server/push');
    await notifyAllSubscribers({
      title: `☕ ${data.title}`,
      body: firstLine.slice(0, 160),
      url: '/jkai/briefing',
    });
  } catch (err) {
    console.error('[briefing] push notify failed:', errMsg(err));
  }
}

export async function runBriefingNow(opts?: { trigger?: 'cron' | 'manual' }): Promise<{ id: string }> {
  if (running) throw new Error('a briefing is already running');
  running = true;
  const id = randomUUID();
  const now = new Date();
  const data: BriefingData = {
    id,
    trigger: opts?.trigger ?? 'manual',
    status: 'running',
    startedAt: now.toISOString(),
    title: `Briefing — ${briefingDateLabel(now)}`,
    markdown: '',
    sources: [],
    llmCalls: 0,
    costUsd: 0,
  };

  try {
    await ensureBriefingsCollection();

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      data.status = 'skipped_disabled';
      data.finishedAt = new Date().toISOString();
      await persist(data);
      return { id };
    }

    const signals = await gatherBriefingSignals();
    data.sources = signals.gathered;

    const topics = (await getSetting<string[]>(SETTINGS_TOPICS_KEY)) ?? [];
    const { markdown, llmCalls, costUsd } = await synthesise(signals, topics);
    data.markdown = markdown;
    data.llmCalls = llmCalls;
    data.costUsd = costUsd;
    data.status = 'complete';
    data.finishedAt = new Date().toISOString();
    await persist(data);
    await notify(data);
  } catch (err) {
    data.status = 'failed';
    data.error = errMsg(err);
    data.finishedAt = new Date().toISOString();
    try {
      await persist(data);
    } catch {
      /* best-effort */
    }
  } finally {
    running = false;
  }
  return { id };
}
