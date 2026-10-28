import { describe, it, expect } from 'vitest';
import { WHATSAPP_CONFIRM_BY_CODE, WHATSAPP_CORE_META_TOOLS, WHATSAPP_READ_TOOLS, WHATSAPP_THREAD_OUTPUTS, WHATSAPP_TOOL_WHITELIST } from './tool-whitelist';
import { declaredTier } from '$lib/tools/declared-tier';

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
  'followup_schedule', 'followup_cancel', 'complete_heartbeat_action', 'schedule_reply_at', 'cancel_scheduled_callback',
  'update_tool', 'author_ephemeral_tool', 'promote_ephemeral_tool', 'blog_create', 'blog_update', 'blog_unpublish',
  'browser_navigate', 'browser_click', 'browser_type', 'api_register', 'api_integration_save', 'datastore_update',
  'datastore_create_collection', 'research_start', 'research_branch', 'research_control', 'request_credential', 'update_credential',
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

  it('holds no tool that acts: those wait for a reply code, off this list', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => ACTS.includes(n))).toEqual([]);
  });

  it('holds no canvas-editing tool', () => {
    const edits = WHATSAPP_TOOL_WHITELIST.filter((n) => byName.get(n)?.toolset === 'workflows' && !/^workflow_(list|inspect|get_run)$/.test(n));
    expect(edits).toEqual([]);
  });

  it('holds only declared reads, apart from the three thread outputs', () => {
    for (const name of WHATSAPP_READ_TOOLS) {
      expect(byName.get(name)?.effect, name).toBe('read');
      expect(declaredTier(byName.get(name)!), name).toEqual({ effect: 'read', confirm: 'never', lane: 'standard' });
    }
    const nonReads = WHATSAPP_TOOL_WHITELIST.filter((n) => byName.has(n) && declaredTier(byName.get(n)!).effect !== 'read');
    expect(nonReads.sort()).toEqual([...WHATSAPP_THREAD_OUTPUTS].sort());
    for (const name of WHATSAPP_THREAD_OUTPUTS) {
      expect(declaredTier(byName.get(name)!), name).toEqual({ effect: 'mutate', confirm: 'never', lane: 'standard' });
    }
  });

  it('has no duplicates', () => {
    expect(new Set(WHATSAPP_TOOL_WHITELIST).size).toBe(WHATSAPP_TOOL_WHITELIST.length);
  });
});

describe('WHATSAPP_CONFIRM_BY_CODE', () => {
  const byName = new Map(getTools().map((t) => [t.name, t]));

  it('is exactly the reviewed list', () => {
    expect([...WHATSAPP_CONFIRM_BY_CODE]).toEqual(['ha_call_service', 'save_memory', 'followup_schedule']);
  });

  it('holds only registered mutates on the standard lane that do not always confirm', () => {
    for (const name of WHATSAPP_CONFIRM_BY_CODE) {
      const tier = declaredTier(byName.get(name)!);
      expect(tier.effect, name).toBe('mutate');
      expect(tier.confirm, name).not.toBe('always');
      expect(tier.lane, name).toBe('standard');
      expect(byName.get(name)?.destructive, name).not.toBe(true);
    }
  });

  it('is never on the whitelist itself, so no Core runs one unconfirmed', () => {
    expect(WHATSAPP_TOOL_WHITELIST.filter((n) => (WHATSAPP_CONFIRM_BY_CODE as readonly string[]).includes(n))).toEqual([]);
  });

  it('is refused for every destructive, always-confirm or commission tool by the live eligibility check', async () => {
    const { replyCodeEligible } = await import('./reply-code.server');
    for (const name of WHATSAPP_CONFIRM_BY_CODE) expect(await replyCodeEligible(name), name).toBe(true);
    const never = getTools().filter((t) => {
      const tier = declaredTier(t);
      return tier.effect === 'destructive' || tier.confirm === 'always' || tier.lane !== 'standard';
    });
    expect(never.length).toBeGreaterThan(10);
    for (const t of never) expect(await replyCodeEligible(t.name), t.name).toBe(false);
    for (const name of ['forget_memory', 'ha_fire_event', 'notify_owner', 'gmail_send', 'develop_commission']) {
      expect(await replyCodeEligible(name), name).toBe(false);
    }
  });
});

