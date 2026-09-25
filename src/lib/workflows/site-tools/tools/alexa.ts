/**
 * The `alexa` toolset — jkai's read-only window onto what the household says
 * to the Echos, and what Alexa said back (/home/voice).
 *
 * Two tools: a summary for "how much / when / who / what about" questions and a
 * search for "what exactly was said". Both read `alexa_utterances`, which the
 * `alexa-voice-sync` heartbeat fills from Home Assistant every five minutes, so
 * "nothing found" before the first row means not yet recorded, not silence —
 * every answer carries the log's own coverage to make that plain.
 *
 * A third, `alexa_home_signals`, reads `alexa_signals` (filled by
 * `alexa-signals-sync`): room temperature, light and motion, pending alarms,
 * timers and reminders, and what the Echos played.
 *
 * This is the whole family's speech, children included. The tools answer the
 * owner's questions; they never send it anywhere.
 */
import { register } from '../registry-internal';
import { optionalString } from '../tool-args';
import { VOICE_TOPICS } from '$lib/alexa/types';

const CATEGORY = 'Personal data';
const TOOLSET = 'alexa';
const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

function daysArg(value: unknown, fallback = DEFAULT_DAYS): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_DAYS, Math.floor(n));
}

function stringArg(args: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = optionalString(args, name);
    if (value) return value;
  }
  return null;
}

function dateArg(args: Record<string, unknown>, ...names: string[]): Date | null {
  const raw = stringArg(args, ...names);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

const CAVEATS = [
  'Only what Alexa itself heard and Home Assistant saw: typed or app commands may not appear, and a device that was offline recorded nothing.',
  'personName is Alexa voice ID\'s guess; null means it did not recognise the speaker, not that nobody spoke.',
  '"missed" is a heuristic on the reply\'s opening ("Sorry…", "Hmm, I\'m not sure…"). An empty reply is Alexa acting (music, news), not a miss.',
  'Times are when Home Assistant received the event, normally seconds after it was said. Saying the identical thing twice in a row to one Echo is logged once (restart replays are filtered that way).',
  'Hours and days are Europe/London.',
];

register({
  name: 'alexa_voice_summary',
  description:
    'Aggregate what the household said to Alexa over a window: total and the previous window for comparison, per day, per hour of day (0–23, Europe/London), per device/room, per recognised speaker, per topic, Amazon intents, the most repeated commands, and how often Alexa missed. Use for "how much do we use Alexa", "what do the kids ask", "when is it busiest". Defaults to the last 30 days.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Window length ending now, 1–366. Default 30.' },
      device: { type: 'string', description: 'Exact device name as returned in byDevice, e.g. "John\'s Echo Studio".' },
      person: { type: 'string', description: 'A recognised first name from byPerson, or "unrecognised".' },
    },
    required: [],
  },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const { voiceSummary } = await import('$lib/alexa/store.server');
    const s = await voiceSummary({
      days: daysArg(args.days),
      device: stringArg(args, 'device'),
      person: stringArg(args, 'person', 'speaker'),
    });
    return {
      success: true,
      data: {
        ...s,
        coverage:
          s.allTime === 0
            ? 'No utterances recorded yet. The log starts from the Home Assistant upgrade on 2026-09-24; nothing earlier exists here.'
            : `Log runs ${s.firstAt} → ${s.lastAt} (${s.allTime} utterances in total).`,
        caveats: CAVEATS,
      },
    };
  },
});

register({
  name: 'alexa_voice_search',
  description:
    'Find individual things said to Alexa, newest first: the words, Alexa\'s reply, device, room, time, recognised speaker, topic and Amazon intent. Filter by text (matches command, reply or intent), device, person, topic, a date range, or only the ones Alexa missed. Use for "what did I ask Alexa about X", "what did Rory say last night", "what couldn\'t Alexa answer".',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to find in the command, reply or intent (case-insensitive substring).' },
      device: { type: 'string', description: 'Device name or part of it, e.g. "kitchen" or "Echo Studio".' },
      person: { type: 'string', description: 'Recognised first name, or "unrecognised".' },
      topic: { type: 'string', enum: [...VOICE_TOPICS], description: 'One topic from the fixed list.' },
      missed_only: { type: 'boolean', description: 'Only utterances Alexa could not handle.' },
      days: { type: 'number', description: 'Look back this many days (ignored when since is given). Default 30.' },
      since: { type: 'string', description: 'ISO date/time lower bound.' },
      until: { type: 'string', description: 'ISO date/time upper bound (exclusive).' },
      limit: { type: 'number', description: 'Max rows, default 50, up to 500.' },
    },
    required: [],
  },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const { searchUtterances } = await import('$lib/alexa/store.server');
    const since = dateArg(args, 'since', 'from');
    const from = since ?? new Date(Date.now() - daysArg(args.days) * 86_400_000);
    const rows = await searchUtterances({
      query: stringArg(args, 'query', 'q', 'text'),
      device: stringArg(args, 'device', 'room'),
      person: stringArg(args, 'person', 'speaker'),
      topic: stringArg(args, 'topic'),
      missedOnly: args.missed_only === true || args.missedOnly === true,
      from,
      to: dateArg(args, 'until', 'to'),
      limit: Number(args.limit) || 50,
    });
    return {
      success: true,
      data: {
        count: rows.length,
        from: from.toISOString(),
        utterances: rows.map((r) => ({
          at: r.occurredAt.toISOString(),
          device: r.device,
          room: r.room,
          person: r.personName,
          said: r.command,
          reply: r.reply,
          topic: r.topic,
          intent: r.intent,
        })),
        caveats: CAVEATS,
      },
    };
  },
});

register({
  name: 'alexa_home_signals',
  description:
    'What the Echos sense and hold, beyond speech: the latest room temperature, light level and motion per device, hourly temperature over the window, when motion was last seen, alarms/timers/reminders pending right now and the ones that came up in the window, and what the Echos played (recent tracks, top artists, per device). Use for "how warm is the kitchen", "has there been movement in X", "what alarms are set", "what have the kids been listening to". Defaults to the last 7 days.',
  parameters: { type: 'object', properties: { days: { type: 'number', description: 'Window length ending now, 1–366. Default 7.' } }, required: [] },
  category: CATEGORY,
  toolset: TOOLSET,
  handler: async (args) => {
    const { houseToolAnswer } = await import('$lib/alexa/store.server');
    return { success: true, data: await houseToolAnswer(daysArg(args.days, 7)) };
  },
});
