import { discoverIntegrations } from '$lib/apis/integration-discovery';
import { resolveCapabilities } from '$lib/jkai/grounding/capabilities';
import { getActivePolicy, describeWithPolicy } from '$lib/toolpolicy/policy';
// `discovery` toolset — how the model finds capability it was not handed.
//
// The old gateway gave the chat surface four discovery verbs, and they were its second
// heaviest category after the site's own tools: 174 `skill_view` calls and 147
// `tool_search`/`tool_describe` calls in 14 days. The in-process lane had
// `activate_toolset` and `jkai_help`, which answer "what toolsets exist" but not
// "is there a tool for X" or "how do I do Y here". These close that gap.
import { register } from '../registry-internal';
import { tools as allTools } from '../registry-internal';
import {
  loadSkillIndex,
  resolveSkill,
  readSkillBody,
  searchSkills,
} from '$lib/jkai/skills/registry';
import { optionalString } from '../tool-args';
import { normalisePrincipal } from '../invoke-contract';
import { capabilitiesFor, isCustomToolset, rankCapabilities } from '$lib/capabilities/manifest';
import { gapTitle, queueCapabilityGap, quotedQuery, type GapOutcome } from '$lib/capabilities/gaps';
import type { CapabilityEntry } from '$lib/capabilities/types';
import type { ToolExecContext } from '../registry-internal';

/** What jkai says a row's status is: one wording everywhere (plan point 7). */
const STATUS_WORDS = { live: 'live', preview: 'preview', planned: 'not built yet' } as const;

function capabilityView(entry: CapabilityEntry, canCommission: boolean) {
  return {
    id: entry.id,
    title: entry.title,
    status: STATUS_WORDS[entry.status],
    blurb: entry.blurb,
    page: entry.pages[0] ?? null,
    ...(entry.notes ? { notes: entry.notes } : {}),
    ...(entry.toolsets.length ? { toolsets: entry.toolsets } : {}),
    ...(entry.status === 'planned' ? { canCommission } : {}),
  };
}

/**
 * The "not built yet" answer, worded once here so jkai_help and tool_search
 * say the same thing: what it is, where it is done today, whether it is on
 * the backlog, and the one offer — only when this turn could commission it.
 */
export function notBuiltYetAnswer(entry: Pick<CapabilityEntry, 'title' | 'pages'> | null, filed: GapOutcome | null, canCommission: boolean): string {
  const what = entry ? `${entry.title} is not built yet` : 'Nothing on the site does that yet';
  const page = entry?.pages[0] ? ` (today: ${entry.pages[0]})` : '';
  const backlog =
    filed?.status === 'queued' || filed?.status === 'already-queued'
      ? " — it's on the backlog"
      : filed === null
        ? ''
        : ' — I could not add it to the backlog just now';
  return `${what}${page}${backlog}.${canCommission ? ' Want me to commission it?' : ''}`;
}

/**
 * Who may file a gap and be offered a commission: the owner, attended. The
 * offer needs a browser session (the commission lane, slice 6b).
 */
function askerOf(ctx: ToolExecContext | undefined): { owner: boolean; attended: boolean; canCommission: boolean } {
  const p = ctx?.principal ? normalisePrincipal(ctx.principal) : null;
  const owner = (p?.principalId ?? ctx?.principalId ?? 'owner') === 'owner';
  const attended = !!p && p.attended && owner;
  return { owner, attended, canCommission: attended && p?.via === 'session' };
}


register({
  name: 'skills_list',
  description:
    'List the available skills — curated playbooks for specific jobs (canvas, home assistant, research, blog, debugging, design...). Each entry is an id and what it covers. Use skill_view to read one. Optionally filter with a query.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Optional keywords to rank by, e.g. "calendar" or "workflow dag".' },
      limit: { type: 'number', description: 'Max results when a query is given (default 10).' },
    },
  },
  category: 'Discovery',
  toolset: 'discovery',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { query?: string; limit?: number };
    try {
      const q = (args?.query ?? '').trim();
      const skills = q ? searchSkills(q, args?.limit ?? 10) : loadSkillIndex();
      return {
        success: true,
        data: {
          count: skills.length,
          total: loadSkillIndex().length,
          skills: skills.map((s) => ({
            id: s.id,
            description: s.description,
            tags: s.tags,
            references: s.references.length,
          })),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'skills_list failed' };
    }
  },
});

register({
  name: 'skill_view',
  description:
    'Read a skill in full by id (from skills_list), e.g. "jkai-canvas" or "research/arxiv". Load a skill before doing the job it covers — it carries the specifics, constraints and traps that generic knowledge does not. Pass `reference` to read one of its reference documents instead.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill id, or its unique frontmatter name.' },
      reference: { type: 'string', description: 'Optional reference document path, as listed by this tool.' },
    },
    required: ['name'],
  },
  category: 'Discovery',
  toolset: 'discovery',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as Record<string, unknown>;
    try {
      const resolved = resolveSkill(optionalString(args, 'name') ?? '');
      if ('error' in resolved) return { success: false, error: resolved.error };
      // `file_path` is what the skills themselves ask for — 13 call sites
      // across 7 skills, 7 of them in jkai-general, the default routing skill.
      // The parameter is `reference`, and an unrecognised key meant
      // `readSkillBody` fell through to SKILL.md and returned `success: true`
      // with the MAIN body. So the model asked for a reference, was handed the
      // wrong document, and had no way to tell — and the unreachable documents
      // are the ones carrying the traps. Coerce, never reject.
      const reference = optionalString(args, 'reference') ?? optionalString(args, 'file_path');
      const body = readSkillBody(resolved.skill, reference);
      if ('error' in body) return { success: false, error: body.error };
      return {
        success: true,
        data: {
          id: resolved.skill.id,
          name: resolved.skill.name,
          description: resolved.skill.description,
          references: resolved.skill.references,
          content: body.text,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'skill_view failed' };
    }
  },
});

register({
  name: 'tool_search',
  description:
    'Search every registered tool by keyword, across all toolsets — including ones not currently active — and the capability list, which says what is live, in preview, or not built yet. Use this before concluding something cannot be done: the capability usually exists under a name you did not guess. Set `requested: true` only when John himself asked for this capability: a not-built-yet hit is then filed on the backlog for him to rule on.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords, e.g. "calendar event" or "resize image".' },
      limit: { type: 'number', description: 'Max results (default 12).' },
      requested: { type: 'boolean', description: 'True only when John asked for this capability himself (not when you are exploring). Files a not-built-yet ask on the backlog.' },
    },
    required: ['query'],
  },
  category: 'Discovery',
  toolset: 'discovery',
  handler: async (raw: Record<string, unknown>, ctx?: ToolExecContext) => {
    const args = (raw ?? {}) as { query?: string; limit?: number; requested?: boolean };
    try {
      const terms = String(args?.query ?? '').toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      if (terms.length === 0) return { success: false, error: 'query is required' };
      const asker = askerOf(ctx);
      const policy = await getActivePolicy();
      let integrations: Awaited<ReturnType<typeof discoverIntegrations>> = []; let integrationLookup: 'ok' | 'unavailable' = 'ok';
      try { integrations = await discoverIntegrations(String(args.query), args.limit ?? 12); } catch { integrationLookup = 'unavailable'; }
      // Saved custom tools are for an attended owner turn only; nobody else is told of them.
      const searchable = asker.attended ? allTools : allTools.filter((t) => !isCustomToolset(t.toolset));
      const hits = resolveCapabilities(searchable, String(args.query), args.limit ?? 12).map(t => ({ t }));
      // Live rows rank above planned ones on a tie, and the live tool hits stay
      // in the answer beside a planned row, so a weak match cannot tell John a
      // live feature does not exist.
      const rows = rankCapabilities(String(args.query), capabilitiesFor(ctx?.principal?.principalId ?? ctx?.principalId), 5);
      const top = rows[0]?.entry ?? null;
      const plannedHit = top?.status === 'planned' ? top : null;
      const zeroHit = hits.length === 0 && rows.length === 0;
      let notBuiltYet: { answer: string; capability: string | null; page: string | null; backlog: string } | undefined;
      if (plannedHit || zeroHit) {
        // Filed only when John asked for it himself on an attended owner turn:
        // never for members, heartbeat, WhatsApp, the bridge or a scheduled
        // run (they get the same answer with nothing filed).
        const file = args.requested === true && asker.attended;
        const filed = file
          ? await queueCapabilityGap({
              capabilityId: plannedHit?.id ?? null,
              title: gapTitle(plannedHit, String(args.query)),
              query: quotedQuery(String(args.query)),
              ...(ctx?.conversationId ? { conversationId: ctx.conversationId } : {}),
            })
          : null;
        notBuiltYet = {
          answer: notBuiltYetAnswer(plannedHit, filed, asker.canCommission),
          capability: plannedHit?.id ?? null,
          page: plannedHit?.pages[0] ?? null,
          backlog: filed ? filed.status : 'not-filed',
        };
      }
      return {
        success: true,
        data: {
          count: hits.length,
          searched: searchable.length,
          integrations, integrationLookup,
          tools: hits.map((r) => ({
            name: r.t.name,
            toolset: r.t.toolset,
            description: describeWithPolicy(policy, r.t.name, r.t.description),
            inputSchema: r.t.parameters,
            destructive: r.t.destructive ?? false,
          })),
          capabilities: rows.map((r) => capabilityView(r.entry, asker.canCommission)),
          ...(notBuiltYet ? { notBuiltYet } : {}),
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'tool_search failed' };
    }
  },
});

register({
  name: 'tool_describe',
  description:
    'Show one tool in full: its description, its toolset, and its exact parameter schema. Call this before using an unfamiliar tool rather than guessing at argument names.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Exact tool name, e.g. "ha_find".' } },
    required: ['name'],
  },
  category: 'Discovery',
  toolset: 'discovery',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { name?: string };
    try {
      const q = String(args?.name ?? '').trim();
      const tool = allTools.find((t) => t.name === q);
      if (!tool) {
        const near = allTools
          .filter((t) => t.name.includes(q) || q.includes(t.name))
          .slice(0, 5)
          .map((t) => t.name);
        return {
          success: false,
          error: near.length
            ? `no tool "${q}". Closest: ${near.join(', ')}`
            : `no tool "${q}". Use tool_search to find one.`,
        };
      }
      return {
        success: true,
        data: {
          name: tool.name,
          toolset: tool.toolset,
          category: tool.category,
          description: tool.description,
          parameters: tool.parameters,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'tool_describe failed' };
    }
  },
});
