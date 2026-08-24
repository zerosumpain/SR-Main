// `discovery` toolset — how the model finds capability it was not handed.
//
// Hermes gave the chat surface four discovery verbs, and they were its second
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
    const args = (raw ?? {}) as { name?: string; reference?: string };
    try {
      const resolved = resolveSkill(args?.name ?? '');
      if ('error' in resolved) return { success: false, error: resolved.error };
      const body = readSkillBody(resolved.skill, args?.reference);
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
    'Search every registered tool by keyword, across all toolsets — including ones not currently active. Use this before concluding something cannot be done: the capability usually exists under a name you did not guess.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords, e.g. "calendar event" or "resize image".' },
      limit: { type: 'number', description: 'Max results (default 12).' },
    },
    required: ['query'],
  },
  category: 'Discovery',
  toolset: 'discovery',
  handler: async (raw: Record<string, unknown>) => {
    const args = (raw ?? {}) as { query?: string; limit?: number };
    try {
      const terms = String(args?.query ?? '').toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      if (terms.length === 0) return { success: false, error: 'query is required' };
      const scored = allTools.map((t) => {
        const name = t.name.toLowerCase();
        const desc = (t.description ?? '').toLowerCase();
        const set = (t.toolset ?? '').toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (name === term) score += 10;
          if (name.includes(term)) score += 4;
          if (set.includes(term)) score += 2;
          if (desc.includes(term)) score += 2;
        }
        return { t, score };
      });
      const hits = scored
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
        .slice(0, args?.limit ?? 12);
      return {
        success: true,
        data: {
          count: hits.length,
          searched: allTools.length,
          tools: hits.map((r) => ({
            name: r.t.name,
            toolset: r.t.toolset,
            description: (r.t.description ?? '').slice(0, 200),
          })),
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
