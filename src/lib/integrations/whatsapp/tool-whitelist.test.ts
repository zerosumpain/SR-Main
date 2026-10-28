import { describe, it, expect } from 'vitest';
import { WHATSAPP_CORE_META_TOOLS, WHATSAPP_TOOL_WHITELIST } from './tool-whitelist';

/**
 * The WhatsApp list against the REAL catalogue: a renamed tool silently
 * dropping out, or a destructive or build tool slipping in, fails here.
 */
const { getTools } = await import('$lib/tools/registry');

const FORBIDDEN_TOOLSETS = new Set(['builds', 'custom-tools', 'whatsapp']);
/** Tools that act, by name: none may be on an unattended lane without a reply-code confirm. */
const ACTS = [
  'ha_call_service', 'ha_fire_event', 'api_call', 'api_integration_call', 'gmail_modify_labels',
  'save_memory', 'memory_remember', 'forget_memory', 'workflow_run', 'workflow_generate',
  'build_create', 'studio_build', 'request_change', 'notify_owner', 'monitor_create', 'datastore_save',
  'schedule_tool_call_at', 'schedule_orchestrator_turn_at', 'register_heartbeat_action', 'agent_spawn',
];

describe('WHATSAPP_TOOL_WHITELIST', () => {
  const byName = new Map(getTools().map((t) => [t.name, t]));

  it('names only registered tools (or Core meta tools)', () => {
    const missing = WHATSAPP_TOOL_WHITELIST.filter((n) => !byName.has(n) && !WHATSAPP_CORE_META_TOOLS.includes(n));
    expect(missing).toEqual([]);
  });

  it('holds no destructive tool', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => byName.get(n)?.destructive)).toEqual([]);
  });

  it('holds no build, commission, custom-tool or outbound-message tool', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => FORBIDDEN_TOOLSETS.has(byName.get(n)?.toolset ?? ''))).toEqual([]);
  });

  it('takes only the catalogue search from the API toolset (its callers can POST, its admin writes secrets)', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => byName.get(n)?.toolset === 'apis')).toEqual(['api_search']);
  });

  it('holds no tool that acts, until reply-code confirms exist', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => ACTS.includes(n))).toEqual([]);
  });

  it('holds no canvas-editing tool', () => {
    const edits = WHATSAPP_TOOL_WHITELIST.filter((n) => byName.get(n)?.toolset === 'workflows' && !/^workflow_(list|inspect|get_run)$/.test(n));
    expect(edits).toEqual([]);
  });

  it('has no duplicates', () => {
    expect(new Set(WHATSAPP_TOOL_WHITELIST).size).toBe(WHATSAPP_TOOL_WHITELIST.length);
  });
});
