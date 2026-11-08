// The owner's private reads, offered to chat (overhaul plan 2026-10-28, P2-2,
// slice 7a): spend_ledger, diary, health_hub, health_series and
// health_activities. One implementation with the daydream think loop
// (`./spend.server`, `./diary.server`, `./health.server`, re-exported by
// `$lib/daydream/think/{reads,health}`), so chat and daydream can never
// disagree about what a pound or a night's sleep was.
//
// The household's reads joined them 2026-11-01 (owner: questions about the
// family's health, comparisons, benchmarks and "who has the most average
// steps over the last 6 days"): household_patterns is daydream's own tool
// (`./household.server`), and household_daily does the sums over any window
// (`./household-daily.server`). Toolset 'people', member-forbidden on both
// sides: the most sensitive data the site holds stays the owner's.
//
// All eleven (with the four photo reads below) are reads, owner-only and NOT member-safe (they are not on the
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
import { MOVEMENT_SECTIONS } from './household';
import { DAILY_METRICS } from './household-daily';
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

register({
  name: 'household_patterns',
  description:
    "The household (everyone on /home/people): ninety days of movement patterns, today's forecast, the weekly digest and month-by-month history. Sections: summary (sharpest findings and one line a person), person (one person in depth: places, routines, time out, steps), forecast (each person's rest of today, anything off routine, forecast accuracy), steps (90-day step averages a person, weekday vs weekend, by weekday, home vs out), together (who is out with whom), habits (household routines and outings), week (each person's last seven days: steps, sleep, workouts; and what changed), months (each month's steps, time out, journeys, distance by person, and the last two months compared). One section per call. Named places only, never coordinates. For any other window or a day-by-day comparison use household_daily. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      section: { type: 'string', enum: [...MOVEMENT_SECTIONS], description: 'Default "summary".' },
      person: { type: 'string', description: 'For section "person": their name.' },
    },
    required: [],
  },
  category: 'Family',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: ownerRead('household_patterns', "The household's movement and week (/home/people)", async (args) => {
    const { householdPatternsTool } = await import('./household.server');
    return householdPatternsTool(args);
  }, '/home/people/patterns'),
});

register({
  name: 'household_daily',
  description:
    "Everyone in the household's health day by day from the SR app (the same Apple Health source for each person, John included), with the arithmetic already done: each person's value on every date, then mean, median, total, highest and lowest day, a ranking, the gap between the top two and the household average. Use it for comparisons and simple maths over any window: \"who has the most average steps over the last 6 days\", \"who slept most this week\", \"workout minutes this month\". Quote its figures rather than recomputing them. The window is London dates ending YESTERDAY (today is a part day, shown separately for steps) unless include_today is set. A missing day is not zero. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      metric: { type: 'string', enum: [...DAILY_METRICS], description: 'steps (default), sleep (hours a night), workouts (minutes), resting_hr (bpm).' },
      days: { type: 'number', minimum: 1, maximum: 90, description: 'How many dates, default 7. Steps up to 90; the others up to 31.' },
      include_today: { type: 'boolean', description: "End the window today (a part day) instead of yesterday. Default false." },
      to: { type: 'string', description: 'Optional last date, YYYY-MM-DD, for a past window. Default yesterday.' },
      person: { type: 'string', description: 'Optional: one person by name. Default everyone.' },
    },
    required: [],
  },
  category: 'Family',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('household_daily', ctx);
    if (refused) return refused;
    try {
      const { householdDailyTool } = await import('./household-daily.server');
      const { label, text, rows } = await householdDailyTool(args ?? {});
      return { success: true, data: { label, text, rows, url: '/home/people/patterns' } };
    } catch (err) {
      return { success: false, error: `household_daily could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});

// The owner's photo library (2026-11-01, owner: "all of that data to be
// available to jkai, including metadata of the images such as location,
// date/time"). SR-Drive owns the Immich connection and the names John gives
// the face clusters on /drive; these four relay Drive's owner-only photo lane
// (`./photos.server`). Toolset 'people', like the household's reads: who is
// in John's photos and where he was are as private as where the family is.

type PhotoRun = (args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;

function photoRead(name: string, load: () => Promise<PhotoRun>) {
  return async (args: Record<string, unknown>, ctx?: Parameters<typeof refuseUnlessOwner>[1]) => {
    const refused = refuseUnlessOwner(name, ctx);
    if (refused) return refused;
    try {
      return await (await load())(args ?? {});
    } catch (err) {
      return { success: false, error: `${name} could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  };
}

register({
  name: 'photo_people',
  description:
    "The people in John's photo library (faces SR-Drive's Immich has clustered, with the names John gave them on /drive): name or null for a face not yet named, how many photos, first and last seen. John sees their faces beside your reply. Use for \"who is in my photos\", \"how many photos of Sam\", \"when did I first take a photo of X\", or to check a name before photo_search. An unnamed person can still be searched by id. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'string', enum: ['all', 'named', 'unnamed'], description: 'Default "all".' },
      name: { type: 'string', description: 'Optional: part of a name to find, e.g. "sam".' },
      limit: { type: 'number', minimum: 1, maximum: 200, description: 'Most people to list, default 50.' },
    },
    required: [],
  },
  category: 'Photos',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: photoRead('photo_people', async () => (await import('./photos.server')).photoPeopleTool),
});

register({
  name: 'photo_search',
  description:
    "Search John's photos and videos (SR-Drive's photo library) by who is in them, where, when, what they show, or words written in them. Each result: id, taken date/time (ISO with its UTC offset), place as \"City, Country\" with lat/lon, people by name, camera; plus where and who the page adds up to. John sees the results as thumbnails beside your reply (a click opens the photo and its Drive file), so describe them by when, where and who; never paste photo links or image markdown. Combine filters freely: \"photos of Sam in Lisbon last summer\" = people [\"Sam\"], place \"Lisbon\", from/to; \"where was I on a date\" = from and to that same date, no other filter, and read the places and times; \"find the photo of the receipt\" = text_in_image \"total\" or text \"receipt\"; \"pictures of the beach\" = text \"beach\". Resolve relative dates (\"last summer\", \"in March\") to YYYY-MM-DD yourself. Newest first unless text is given (then best match), and with text there may also be `described`: photos whose written description holds every word, each with that caption — use them, they are often the best answer to \"the photo of X\". Use photo_detail for one photo's full text, faces and Drive link. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      people: { type: 'array', items: { type: 'string' }, description: 'Names (or person ids from photo_people); every one must be in the photo.' },
      place: { type: 'string', description: 'City, region or country, e.g. "Lisbon" or "Portugal".' },
      from: { type: 'string', description: 'Earliest date taken, YYYY-MM-DD (inclusive).' },
      to: { type: 'string', description: 'Latest date taken, YYYY-MM-DD (inclusive).' },
      text: { type: 'string', description: 'What the photo shows, in plain words (smart search): "dog on a beach", "birthday cake", "receipt".' },
      text_in_image: { type: 'string', description: 'Words written in the image (OCR): a sign, a receipt, a document.' },
      type: { type: 'string', enum: ['photo', 'video'], description: 'Only photos or only videos. Default both.' },
      limit: { type: 'number', minimum: 1, maximum: 100, description: 'Results per page, default 25.' },
      page: { type: 'number', minimum: 1, description: 'Page of results, default 1.' },
    },
    required: [],
  },
  category: 'Photos',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: photoRead('photo_search', async () => (await import('./photos.server')).photoSearchTool),
});

register({
  name: 'photo_detail',
  description:
    "One photo or video from John's library in full, by the id photo_search returned: when (ISO with offset) and time zone, place with region and lat/lon, camera and lens, size, the people whose faces are in it (named or not), the words written in it (OCR text, e.g. a receipt's lines), `seen` (what the picture shows: a caption and the objects in it, with counts, once it has been described), and the Drive file link. Use it to read a receipt or sign, or to say exactly who is in a picture. For a video it also gives the analysis (photo_analyse_video), when there is one: each person and each piece of on-screen text once with the time ranges they appear and links to those moments. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The photo id from photo_search.' },
    },
    required: ['id'],
  },
  category: 'Photos',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: photoRead('photo_detail', async () => (await import('./photos.server')).photoDetailTool),
});

register({
  name: 'photo_stats',
  description:
    "An overview of John's photo library: how many photos and videos, named and unnamed people, the date range it covers, the places with the most photos, and whether Immich is still processing (if so, counts, faces and places are incomplete — say so). Use for \"how many photos have I got\", \"where do I take most photos\", \"is the photo library ready\". Read-only.",
  parameters: {
    type: 'object',
    properties: {
      top_places: { type: 'number', minimum: 1, maximum: 30, description: 'How many top places to list, default 10.' },
    },
    required: [],
  },
  category: 'Photos',
  toolset: 'people',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: photoRead('photo_stats', async () => (await import('./photos.server')).photoStatsTool),
});

// Video analysis on request (2026-11-02, owner: "count a face ... one per video
// not per frame ... grouping in blocks of 10 seconds"). The one photo tool that
// changes something: 'start' queues a CPU job on SR-Drive's analyser, so it is
// a mutate (refused unattended), with no card: a long video already stops at
// Drive's own needsConfirm and the model must ask John before `confirm: true`.

register({
  name: 'photo_analyse_video',
  description:
    "Analyse one of John's videos for who appears in it and what text is shown, and when. Runs only when asked, one video at a time, and takes minutes: action 'start' (default) queues it and answers at once with its place in the queue; call again later with action 'status', or read photo_detail, which carries the results once done. Results are per person per video, not per frame: each recognised person (by the names John gave on /drive) and each distinct piece of on-screen text once, with the time ranges (m:ss, from 10-second blocks) it appears and a link that opens the video at that moment; faces with no person are only counted. Give the video id from photo_search, or describe it (text, people, place, from/to) and it is looked up among videos; if more than one matches nothing starts and the candidates come back, so ask John which. A long video needs John's yes: the answer gives its length and a processing estimate; ask him, and only after he agrees call again with confirm true. force re-analyses a video already done; 'cancel' stops a queued or running one.",
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The video id from photo_search. Or leave it out and describe the video below.' },
      action: { type: 'string', enum: ['start', 'status', 'cancel'], description: 'Default "start" (queue the analysis). "status" reads progress or results; "cancel" stops it.' },
      text: { type: 'string', description: 'Without an id: what the video shows, in plain words, e.g. "cutting the birthday cake".' },
      people: { type: 'array', items: { type: 'string' }, description: 'Without an id: names who must be in the video.' },
      place: { type: 'string', description: 'Without an id: city, region or country.' },
      from: { type: 'string', description: 'Without an id: earliest date taken, YYYY-MM-DD.' },
      to: { type: 'string', description: 'Without an id: latest date taken, YYYY-MM-DD.' },
      confirm: { type: 'boolean', description: 'True only after John has agreed to analyse a long video (the answer asked for it).' },
      force: { type: 'boolean', description: 'True to re-analyse a video already analysed (replaces the old result).' },
    },
    required: [],
  },
  category: 'Photos',
  toolset: 'people',
  effect: 'mutate',
  confirm: 'never',
  surfaces: ['chat', 'app'],
  handler: photoRead('photo_analyse_video', async () => (await import('./photo-video.server')).photoAnalyseVideoTool),
});
