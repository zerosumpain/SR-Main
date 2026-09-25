// src/lib/daydream/think/tools.ts
//
// What a think cycle may call, and the card every answer becomes.
//
// ── Two sets, never one — the injection boundary ───────────────────────────
//
// A cycle holding private data must never read text somebody else wrote while
// it can also reach outwards. So there are two POSITIVE allow-lists and a cycle
// gets exactly one:
//
//   PRIVATE   (every channel but research) — read-only reads over the owner's
//             own data. No web. Nothing that returns a stranger's prose at
//             length: no mail bodies, no fetched pages, no assistant turns.
//   RESEARCH  (the research channel) — web search and fetch, and NOTHING
//             private. Its brief carries his stated interests and notebook
//             titles, which he chose to have looked up; nothing else of his.
//
// Both lists are positive and pinned by `tools.test.ts`, for the reason
// `ponder/lookups.ts` spells out: the `destructive` flag marks 21 of 188 tools
// and is not a read/write split (`ha_call_service`, `save_memory`,
// `workflow_run` all write and none are flagged), and `executeTool` applies no
// gate of its own on a headless path. The list IS the gate — and it is passed
// to the executor as `allowedTools` as well, so a name that slipped past the
// check here would still be refused there.
//
// Every site tool below was read before it was listed:
//
//   ha_find          GET /api/states, filtered in process          read
//   ha_query_state   GET /api/states/<id>                          read
//   ha_get_history   GET /api/history/period/…                     read
//   memory_search    SELECT over jkai_memories (personal scope)    read
//   health_timeline  service-lane GET to SR-Health                 read
//   research_web_search   Tavily search, 300-char snippets         read (web)
//   fetch_url        GET a public URL, private ranges refused      read (web)
//
// NOT listed, deliberately: `ha_render_template` (arbitrary Jinja is a larger
// surface than any question needs), `mail_search`/`mail_read` (passages of the
// mail BODY), `session_search` (assistant turns can quote fetched pages),
// `apple_calendar_list` (bypasses the owner's diary exclusions — `diary` reads
// through them), every `gmail_*` (picks a mailbox; see reads.ts).
//
// ── Cards ──────────────────────────────────────────────────────────────────
//
// Every result is wrapped by CODE as a card `{id, tool, args, text}`, and the
// model only ever sees it under its id. The audit then checks every citation
// against the cards actually issued, so cite-or-die moves from "code built the
// pack" to "code built every card the model saw" — the property
// `ponder/lookups.ts` was protecting, kept rather than traded away.

import { createCorrelator, correlateDescription } from './correlate';
import { HUB_SECTIONS, healthHubTool, healthSeriesDescription, healthSeriesTool } from './health';
import { chatThreadsTool, diaryTool, mailFactsTool, spendTool } from './reads';
import { isResearchChannel, type Channel } from './questions';
import { errMsg } from '../types';

/** Registered site tools a PRIVATE cycle may call. */
export const PRIVATE_SITE_TOOLS = ['ha_find', 'ha_query_state', 'ha_get_history', 'memory_search', 'health_timeline'] as const;

/** Tools implemented here, over the owner's data. PRIVATE only. */
export const LOCAL_TOOLS = ['health_hub', 'health_series', 'correlate', 'mail_facts', 'diary', 'spend', 'chat_threads'] as const;
export type LocalTool = (typeof LOCAL_TOOLS)[number];

/** Registered site tools a RESEARCH cycle may call. */
export const RESEARCH_SITE_TOOLS = ['research_web_search', 'fetch_url'] as const;

export const PRIVATE_TOOLS: readonly string[] = [...PRIVATE_SITE_TOOLS, ...LOCAL_TOOLS];
export const RESEARCH_TOOLS: readonly string[] = [...RESEARCH_SITE_TOOLS];

export type ToolSet = 'private' | 'research';

export function toolSetFor(channel: Channel): ToolSet {
  return isResearchChannel(channel) ? 'research' : 'private';
}

export function toolsIn(set: ToolSet): readonly string[] {
  return set === 'research' ? RESEARCH_TOOLS : PRIVATE_TOOLS;
}

/** Tool calls one cycle may make in total, across every round. */
export const MAX_TOOL_CALLS = 12;

/** A card's text is cut here. Enough for a month of a daily series or a
 *  digest; not enough for one fetched page to become the whole prompt. */
export const CARD_CHARS = 2400;

export interface Card {
  /** "C1", "C2" … in issue order. The only thing the model may cite. */
  id: string;
  tool: string;
  args: Record<string, unknown>;
  text: string;
  /**
   * A stable identity for what was read — tool, arguments and the local day —
   * so two notes resting on the same reads are recognisably the same claim to
   * the live-echo guard (`refutations.ts`). The card id is per-cycle and would
   * never match across cycles.
   */
  ref: string;
}

/** Arguments with sorted keys, so `{a,b}` and `{b,a}` are the same read. */
export function stableArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  return JSON.stringify(keys.map((k) => [k, args[k]]));
}

export function makeCard(n: number, tool: string, args: Record<string, unknown>, raw: unknown, day: string): Card {
  const full = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null);
  const text = full.length > CARD_CHARS ? `${full.slice(0, CARD_CHARS)} …[truncated, ${full.length - CARD_CHARS} more chars]` : full;
  return { id: `C${n}`, tool, args, text, ref: `${tool}:${stableArgs(args)}@${day}` };
}

/** What the model sees for a card. The id leads so it is the thing to copy. */
export function renderCard(card: Card): string {
  return `[${card.id}] ${card.tool}(${JSON.stringify(card.args)})\n${card.text}`;
}

// ── Local tool schemas ─────────────────────────────────────────────────────
//
// Every schema has at least one property. `{type:'object', properties:{}}`
// arrives on Codex as `{}`, and a tool with no parameters there is a tool the
// model is told takes nothing and then cannot be called with anything.

type ToolDefinition = { type: 'function'; function: { name: string; description: string; parameters: unknown } };

const LOCAL_DEFINITIONS: Record<LocalTool, () => ToolDefinition['function']> = {
  health_hub: () => ({
    name: 'health_hub',
    description:
      "What /health has concluded about him right now: the one-line read, readiness and its factors, the instruments with what each means, forecasts, ranked moves, every tripwire with its meaning, today's proposed session, live experiments and the verdict. Read this before proposing anything about his health, so you build on it rather than contradict it.",
    parameters: {
      type: 'object',
      properties: {
        sections: {
          type: 'array',
          items: { type: 'string', enum: [...HUB_SECTIONS] },
          description: 'Only these sections. Omit for all of them.',
        },
      },
    },
  }),
  health_series: () => ({
    name: 'health_series',
    description: healthSeriesDescription(),
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'One series key, exactly as listed.' },
        days: { type: 'number', description: 'Window in days, 7–120. Default 28.' },
      },
      required: ['metric'],
    },
  }),
  correlate: () => ({
    name: 'correlate',
    description: correlateDescription(),
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'string', description: 'First metric key.' },
        b: { type: 'string', description: 'Second metric key. The lagged test reads a today against b tomorrow.' },
        days: { type: 'number', description: 'Window in days, 21–365. Default 90.' },
      },
      required: ['a', 'b'],
    },
  }),
  mail_facts: () => ({
    name: 'mail_facts',
    description:
      "His mail as facts and metadata only: dated obligations the ingest extracted (renewals, appointments, deliveries, deadlines), and who wrote when (sender domain, subject, kind). Never message bodies.",
    parameters: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'How far back, 1–60. Default 14.' },
        daysAhead: { type: 'number', description: 'How far ahead for dated facts, 0–90. Default 30.' },
        query: { type: 'string', description: 'Optional word to filter subjects and fact titles by.' },
      },
    },
  }),
  diary: () => ({
    name: 'diary',
    description:
      'His calendar, with the events he told the engine to ignore already removed. Dates accept YYYY-MM-DD or relative forms ("today", "-7d", "+14d").',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start. Default "today".' },
        to: { type: 'string', description: 'End. Default "+14d".' },
        query: { type: 'string', description: 'Optional text to match in title or location.' },
      },
    },
  }),
  spend: () => ({
    name: 'spend',
    description:
      'His verified spend rows (receipts and bank lines that passed verification), totalled by merchant and listed by day.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Window in days, 7–180. Default 60.' },
        merchant: { type: 'string', description: 'Optional merchant name filter.' },
      },
    },
  }),
  chat_threads: () => ({
    name: 'chat_threads',
    description:
      'His recent jkai chat threads: title, how many messages he sent, when, and his opening line. His own words only.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Window in days, 1–60. Default 14.' } },
    },
  }),
};

function isLocal(name: string): name is LocalTool {
  return (LOCAL_TOOLS as readonly string[]).includes(name);
}

export interface ToolCallOutcome {
  card: Card | null;
  /** What the model is shown in the tool message: the card, or why there is none. */
  content: string;
  failed: boolean;
}

/**
 * One cycle's tools: the definitions to offer, and a caller that refuses
 * anything outside the cycle's set BEFORE it runs, and cards what it runs.
 */
export function createToolbox(opts: { set: ToolSet; now: Date; day: string; subject: string }) {
  const allowed = toolsIn(opts.set);
  const cards = new Map<string, Card>();
  const correlate = createCorrelator({ subject: opts.subject, now: opts.now });
  let calls = 0;

  async function runLocal(name: LocalTool, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'health_hub':
        return healthHubTool(args);
      case 'health_series':
        return healthSeriesTool(args, opts.now);
      case 'correlate':
        return (await correlate(args)).text;
      case 'mail_facts':
        return mailFactsTool(args, opts.now);
      case 'diary':
        return diaryTool(args);
      case 'spend':
        return spendTool(args, opts.now);
      case 'chat_threads':
        return chatThreadsTool(args, opts.now);
    }
  }

  return {
    set: opts.set,
    allowed,
    cards,
    get calls() {
      return calls;
    },

    async definitions(): Promise<ToolDefinition[]> {
      const local = allowed.filter(isLocal).map((n) => ({ type: 'function' as const, function: LOCAL_DEFINITIONS[n]() }));
      const siteNames = allowed.filter((n) => !isLocal(n));
      let site: ToolDefinition[] = [];
      if (siteNames.length) {
        const { getToolDefinitionsByName } = await import('$lib/workflows/site-tools/llm-tools');
        site = (await getToolDefinitionsByName(siteNames)) as ToolDefinition[];
      }
      return [...local, ...site];
    },

    async call(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
      if (!allowed.includes(name)) {
        return { card: null, failed: true, content: `Refused: ${name} is not available in a ${opts.set} cycle.` };
      }
      if (calls >= MAX_TOOL_CALLS) {
        return { card: null, failed: true, content: `Refused: this cycle has used all ${MAX_TOOL_CALLS} tool calls. Write your answer.` };
      }
      calls++;
      let raw: unknown;
      try {
        if (isLocal(name)) {
          raw = await runLocal(name, args);
        } else {
          const { executeSiteTool } = await import('$lib/workflows/site-tools/executor');
          // The allow-list again, as the executor's own capability scope.
          const res = await executeSiteTool(name, args, { emit: () => {}, allowedTools: [...allowed] });
          if (!res?.success) {
            return { card: null, failed: true, content: `No card — ${name} failed: ${(res?.error ?? 'no result').slice(0, 200)}` };
          }
          raw = res.data;
        }
      } catch (err) {
        return { card: null, failed: true, content: `No card — ${name} threw: ${errMsg(err).slice(0, 200)}` };
      }
      const card = makeCard(cards.size + 1, name, args, raw, opts.day);
      cards.set(card.id, card);
      return { card, failed: false, content: renderCard(card) };
    },
  };
}

export type Toolbox = ReturnType<typeof createToolbox>;
