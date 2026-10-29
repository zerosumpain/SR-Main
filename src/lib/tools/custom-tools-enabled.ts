import { CUSTOM_TOOLSET_PREFIX } from '$lib/capabilities/types';
import { isCustomToolset } from '$lib/capabilities/manifest';

/**
 * The saved custom tools re-enabled for owner chat (plan P2-0a, decision 8).
 *
 * THIS LIST IS THE SWITCH, and it is reviewed here rather than written into
 * production rows: a `custom_tools` row loads only when it is enabled AND
 * named below. Everything else stays dark, whatever its `enabled` flag says.
 * To veto one, delete its line; to add one, it must meet all three tests the
 * triage set (`custom-tools-triage-2026-10-28.md`):
 *
 *   (a) real chat use — called from a chat turn, not only by probe runs;
 *   (b) reads no secrets or tokens (the triage's "secrets" reach);
 *   (c) writes nothing — no database, file or tool that changes state.
 *
 * How a re-enabled tool runs:
 * - loaded into the WEB process only (`hooks.server.ts`), never the builder
 *   or the WhatsApp worker;
 * - re-homed under the reserved `custom:<toolset>` toolset, and skipped if
 *   its name collides with a built-in tool;
 * - declared `effect: 'read'`, and its `platform.call` may only reach read
 *   tools (`refuseNonReadCall`) with the caller's own principal, allowedTools
 *   and tier — so it cannot launder a mutate such as `ha_call_service`;
 * - offered and run only for the owner on an attended turn: `executeTool`
 *   refuses it for WhatsApp, heartbeat, the bridge, workflow nodes and every
 *   other unattended caller, and the catalogue leaves it out of the
 *   unattended audience and MCP.
 */
/**
 * - pinned to the code that was reviewed: `sha256` is the hex SHA-256 of the
 *   row's `handler_code` (UTF-8), taken read-only from production on
 *   2026-10-29. A row whose code no longer hashes to it is NOT loaded (and the
 *   mismatch is logged), so an edit to a row — by an agent, a migration or by
 *   hand — turns the tool off until someone reviews it and updates the pin.
 */
export const REENABLED_CUSTOM_TOOLS: ReadonlyArray<{ name: string; sha256: string; why: string }> = [
  {
    name: 'home_security_status',
    sha256: 'a9cefbd6a221cc9907e77313c852a897a4025b49e1fb64d38930970a1ef54aff',
    why: 'Most-used from chat (5 chat calls, 70 runs, 1% errors): locks, door and window sensors and motion in one answer, through Home Assistant reads.',
  },
  {
    name: 'platform_live_status',
    sha256: '2c974b2fdd3c6ad6cc44cdbb8f1036376e484a4a8cab9ca91272836ad1c58406',
    why: 'Five chat calls, 0% errors: workflows, scheduler health, callbacks and recent builds in one snapshot, from read tools.',
  },
  {
    name: 'f1_driver_standings',
    sha256: 'a3ca2c854e133ffd31d6e87817ea32ad56f87561ba680028c049f82f296a8930',
    why: 'Three chat calls: Formula 1 standings from the public Jolpica API; no key, nothing on the site touched.',
  },
  {
    name: 'wikipedia_live_summary',
    sha256: '6bda7a667b55c8f397e439d33793743509a96dbd695ce6751690ab7a181cbd2e',
    why: 'Three chat calls: a Wikipedia summary and link from the public MediaWiki API; no key.',
  },
  {
    name: 'health_today_summary',
    sha256: 'ed21d6e058e014414c4d870d17746f255930d9524c4e4e9a54f6d8a9978752f5',
    why: 'Called from chat, 57 runs with no errors: sleep, recovery and strain for today, from the health read tools.',
  },
];

export const REENABLED_CUSTOM_TOOL_NAMES: ReadonlySet<string> = new Set(REENABLED_CUSTOM_TOOLS.map((t) => t.name));

/** The reviewed handler hash for each re-enabled tool, by name. */
export const REENABLED_CUSTOM_TOOL_HASHES: ReadonlyMap<string, string> = new Map(REENABLED_CUSTOM_TOOLS.map((t) => [t.name, t.sha256]));

/** The reserved toolset a re-enabled custom tool lives in. */
export function customToolsetFor(toolset: string | null | undefined): string {
  const base = (toolset ?? '').trim().replace(/^custom[:-]?/, '') || 'tools';
  return `${CUSTOM_TOOLSET_PREFIX}${base}`;
}

/** Is this a loaded custom tool (by its re-homed toolset)? */
export function isCustomTool(tool: { toolset: string }): boolean {
  return isCustomToolset(tool.toolset);
}
