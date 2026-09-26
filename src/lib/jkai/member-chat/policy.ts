// What a member's jkai turn may do — the closed list, and the prompt it runs
// under. PURE: no imports that reach the owner's data.
//
// A member's turn is not the owner's turn with things hidden. The owner's
// prompt describes the owner (`data/prompts/01-soul.md`, `04-context.md`), the
// owner's tool guide carries the owner's WhatsApp number, and most toolsets act
// AS the owner — his mail, memory, calendar, house, secrets, schedules and
// builders. So a member turn runs on its own persona and this allow-list,
// enforced where tools EXECUTE (the executor refuses any other name), not only
// in what the model is offered.
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md (jkai chat).

/**
 * Every tool a member turn may call. Each one reads only the public web, the
 * news wires, or the member's own thread, and none sends, schedules, spends
 * heavily or runs code:
 *
 *   research_web_search  a web search (metered per turn by the round cap)
 *   fetch_url            one page, through the SSRF-guarded fetch
 *   news_search          the public news wires
 *   render_chart / render_table / render_diagram   pure renderers
 *   evidence_read        evidence stored against THIS thread
 *
 * Deliberately NOT here: `api_call` / `api_search` (they carry the owner's
 * saved secrets), `tool_search` (lists the owner's integrations), skills,
 * `activate_toolset`, `jkai_help`, `agent_spawn` and every authoring meta tool.
 */
export const MEMBER_CHAT_TOOLS = [
  'research_web_search',
  'fetch_url',
  'news_search',
  'render_chart',
  'render_table',
  'render_diagram',
  'evidence_read',
] as const;

/** Toolsets whose tools a member turn must never be able to reach, by any name. */
export const MEMBER_FORBIDDEN_TOOLSETS = [
  'memory',
  'recall',
  'gmail',
  'mail',
  'files',
  'datastore',
  'home',
  'alexa',
  'whatsapp',
  'followups',
  'heartbeat',
  'schedule',
  'monitors',
  'agents',
  'media',
  'builds',
  'workflows',
  'custom-tools',
  'scraper',
  'browser',
  'node-builder',
  'intel-graph',
  'knowledge',
  'apis',
  'apple-calendar',
  'health',
  'activity',
  'blog',
  'diagnostics',
] as const;

/** A turn restricted to one principal and a closed tool list. */
export interface TurnRestriction {
  principalId: string;
  allow: readonly string[];
}

export function memberRestriction(principalId: string): TurnRestriction {
  return { principalId, allow: [...MEMBER_CHAT_TOOLS] };
}

/**
 * The system prompt for a member's turn, in place of the owner's prompt files.
 * It names no one: the member is "the person you are talking to", and nothing
 * here describes the site's owner or their life.
 */
export const MEMBER_PERSONA_PROMPT = `You are jkai, a helpful assistant on a private family website.

You are talking with a member of the household who has been given access to chat. Be warm, direct and useful. Answer in plain English.

You can search the web, read a web page, search the news wires, and draw charts, tables and diagrams. You cannot read anyone's email, calendar, files, notes, memory, location or health data, you cannot send messages, schedule anything, or run code — if asked, say so plainly and suggest what you can do instead.

Do not guess at facts about the person you are talking to or about anyone else in the household: you do not have that information.`;

/** The capabilities section a member's prompt carries, listing only what they have. */
export function memberCapabilitiesSection(): string {
  return [
    '## What you can do in this conversation',
    '- research_web_search: search the web.',
    '- fetch_url: read one public web page.',
    '- news_search: search recent news.',
    '- render_chart, render_table, render_diagram: show data visually.',
    '- evidence_read: re-read evidence gathered earlier in this conversation.',
    'You have no other tools.',
  ].join('\n');
}
