// The owner's private reads, offered to chat (overhaul plan 2026-10-28, P2-2,
// slice 7a): spend_ledger, diary, health_hub, health_series and
// health_activities. One implementation with the daydream think loop
// (`./spend.server`, `./diary.server`, `./health.server`, re-exported by
// `$lib/daydream/think/{reads,health}`), so chat and daydream can never
// disagree about what a pound or a night's sleep was.
//
// All five are reads, owner-only and NOT member-safe (they are not on the
// contract's MEMBER_SAFE_TOOLS list, so `executeTool` refuses any member; the
// handler's `refuseUnlessOwner` is the second wall). Not offered to WhatsApp or
// the heartbeat, whose whitelists name their tools.
//
// Registered from here (src/hooks.server.ts imports this module at boot), not
// imported by $lib/tools/registry: the domain registers its own chat tools, as
// $lib/daydream/chat-tools does, so the registry never imports a domain back.

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { diaryTool } from './diary.server';
import { spendTool } from './spend.server';
import { HUB_SECTIONS, activitiesTool, healthHubTool, healthSeriesDescription, healthSeriesTool } from './health.server';

type Read = (args: Record<string, unknown>) => Promise<string>;

/** One owner read as a tool result: the text, what it is, and where to look. */
function ownerRead(name: string, label: string, read: Read, url?: string) {
  return async (args: Record<string, unknown>, ctx?: Parameters<typeof refuseUnlessOwner>[1]) => {
    const refused = refuseUnlessOwner(name, ctx);
    if (refused) return refused;
    try {
      const text = await read(args ?? {});
      return { success: true, data: { label, text, ...(url ? { url } : {}) } };
    } catch (err) {
      return { success: false, error: `${name} could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  };
}

register({
  name: 'spend_ledger',
  description:
    "John's spend, reconciled against the bank: each line is tagged [bank], [PayPal], [bank→PayPal top-up] or [email]. Only bank and PayPal lines are payments; an email is a receipt about one and is paired with it; a top-up funds PayPal payments. Totals count payments only. Use for \"what did I spend on X\", \"last week's spend\". No verified line means no evidence, not no spending. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', minimum: 7, maximum: 180, description: 'Window in days, 7–180. Default 60.' },
      merchant: { type: 'string', description: 'Optional merchant name to filter by.' },
    },
    required: [],
  },
  category: 'Money',
  toolset: 'money',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('spend_ledger', "John's verified spend, reconciled (bank and PayPal lines are payments)", (args) => spendTool(args)),
});

register({
  name: 'diary',
  description:
    'John\'s diary: his calendar with the events he told jkai to ignore already removed (kit reminders and the like). Prefer this to apple_calendar_list for "what\'s on", "am I free", "what have I got this week". Dates accept YYYY-MM-DD or relative forms ("today", "-7d", "+14d"). A calendar that cannot be read is unknown, never empty. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Start. Default "today".' },
      to: { type: 'string', description: 'End. Default "+14d".' },
      query: { type: 'string', description: 'Optional text to match in title or location.' },
    },
    required: [],
  },
  category: 'Calendar',
  toolset: 'apple-calendar',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('diary', "John's diary, with his excluded events removed", (args) => diaryTool(args), '/jkai/daydreams/calendar'),
});

register({
  name: 'health_hub',
  description:
    "What /health has concluded about John right now: the one-line read, readiness and its factors, the instruments with what each means, forecasts, ranked moves, every tripwire with its meaning, today's proposed session, live experiments and the verdict. Read this before advising on his health, so the answer builds on the health page rather than contradicting it. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      sections: {
        type: 'array',
        items: { type: 'string', enum: [...HUB_SECTIONS] },
        description: 'Only these sections. Omit for all of them.',
      },
    },
    required: [],
  },
  category: 'Health Data',
  toolset: 'health',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('health_hub', 'The /health digest (written by SR-Health)', (args) => healthHubTool(args), '/health'),
});

register({
  name: 'health_series',
  description: `${healthSeriesDescription()} Read-only.`,
  parameters: {
    type: 'object',
    properties: {
      metric: { type: 'string', description: 'One series key, exactly as listed.' },
      days: { type: 'number', minimum: 7, maximum: 120, description: 'Window in days, 7–120. Default 28.' },
    },
    required: ['metric'],
  },
  category: 'Health Data',
  toolset: 'health',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('health_series', "One of John's health metrics by day", (args) => healthSeriesTool(args), '/health'),
});

register({
  name: 'health_activities',
  description:
    "John's recent activities: workouts from Apple Health and the outings the SR iPhone app caught in the background ('caught by the app') — type, when, distance, duration, pace, heart rate. No coordinates. Read-only.",
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', minimum: 5, maximum: 60, description: 'Most recent N, 5–60. Default 30.' } },
    required: [],
  },
  category: 'Health Data',
  toolset: 'health',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('health_activities', "John's recent workouts and outings", (args) => activitiesTool(args), '/health'),
});
