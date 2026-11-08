import { afterAll, describe, expect, it } from 'vitest';
import { declaredTier } from './declared-tier';
import { register, unregister } from './registry-internal';
import { unattendedPrincipal } from './in-process-principal';
import { TOOL_EFFECTS } from './invoke-contract';

/**
 * Fail closed on tool effects (overhaul plan 2026-10-28, principle "an unknown
 * tool counts as destructive"). The catalogue used to derive `effect: 'read'`
 * for every tool that never declared one, so forget_memory, followup_schedule,
 * write_document and update_tool reached unattended callers as "reads".
 *
 * Every registered tool now declares its effect, judged from its handler; one
 * that does not is served and enforced as destructive.
 */
const reg = await import('./registry');
// The domains that register their chat tools from hooks.server.ts.
await import('$lib/daydream/chat-tools');
await import('$lib/owner-data/chat-tools');
await import('$lib/trips/chat-tools');
await import('$lib/captures/chat-tools');

const PROBE = 'tool_effects_probe_undeclared';

/** Known writers: each changes, schedules, sends, runs code or spends. None may be a read. */
const WRITERS = [
	'forget_memory', 'save_memory', 'memory_remember',
	'followup_schedule', 'followup_cancel',
	'register_heartbeat_action', 'complete_heartbeat_action',
	'schedule_reply_at', 'schedule_tool_call_at', 'schedule_orchestrator_turn_at', 'cancel_scheduled_callback',
	'write_document', 'generate_image', 'generate_audio_tts',
	'update_tool', 'delete_tool', 'author_ephemeral_tool', 'promote_ephemeral_tool',
	'ha_call_service', 'ha_fire_event',
	'notify_owner', 'whatsapp_send', 'gmail_send', 'gmail_reply', 'gmail_modify_labels',
	'blog_create', 'blog_update', 'blog_unpublish', 'publish_page',
	'build_create', 'build_tweak', 'build_control', 'build_write_file', 'register_chat_build', 'studio_build',
	'research_start', 'research_control', 'research_branch',
	'workflow_build_from_spec', 'workflow_amend', 'workflow_add_node', 'workflow_run', 'workflow_generate', 'workflow_add_schedule',
	'monitor_create', 'datastore_save', 'datastore_update', 'datastore_create_collection',
	'api_call', 'api_register', 'api_integration_save', 'api_integration_call',
	'request_credential', 'update_credential',
	'browser_navigate', 'browser_click', 'browser_type',
	'apple_calendar_create', 'trip_converse', 'daydream_do', 'develop_commission',
];

afterAll(() => {
	unregister(PROBE);
});

describe('every registered tool declares its effect', () => {
	it('has no tool without an explicit effect', () => {
		const missing = reg.getTools().filter((t) => !t.name.startsWith('tool_effects_probe_') && t.effect === undefined).map((t) => t.name);
		expect(missing).toEqual([]);
		for (const t of reg.getTools()) expect(TOOL_EFFECTS, t.name).toContain(t.effect ?? 'destructive');
	}, 120_000);

	it('keeps destructive flags and destructive effects in step', () => {
		for (const t of reg.getTools()) {
			expect(t.destructive === true, t.name).toBe(t.effect === 'destructive');
			if (t.destructive) expect(declaredTier(t), t.name).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
		}
	});

	it('never labels a known writer a read', () => {
		const byName = new Map(reg.getTools().map((t) => [t.name, t]));
		for (const name of WRITERS) {
			const t = byName.get(name);
			expect(t, name).toBeDefined();
			expect(declaredTier(t!).effect, name).not.toBe('read');
		}
	});

	it('serves no read tier for a writer on the catalogue, and no row without one', async () => {
		const { catalogueTools } = await import('./catalogue');
		const rows = await catalogueTools();
		for (const r of rows) expect(TOOL_EFFECTS, r.name).toContain(r.effect);
		const byName = new Map(rows.map((r) => [r.name, r]));
		for (const name of WRITERS) expect(byName.get(name)?.effect, name).not.toBe('read');
	});
});

describe('an undeclared tool fails closed', () => {
	it('is destructive in declaredTier, on the catalogue, to the gate and in executeTool', async () => {
		let ran = false;
		register({
			name: PROBE,
			description: 'undeclared probe',
			parameters: { type: 'object', properties: {} },
			category: 'Test',
			toolset: 'test',
			handler: async () => {
				ran = true;
				return { success: true };
			},
		});
		expect(declaredTier(reg.getTool(PROBE)!)).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
		expect(declaredTier({})).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
		expect(declaredTier({ destructive: false })).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
		const { catalogueTools, isDestructiveTool } = await import('./catalogue');
		expect((await catalogueTools()).find((r) => r.name === PROBE)).toMatchObject({ effect: 'destructive', destructive: true });
		expect(await isDestructiveTool(PROBE)).toBe(true);
		const { isDestructive } = await import('$lib/jkai/chat/confirmation-gate');
		expect(await isDestructive(PROBE)).toBe(true);
		// Even listed, an unattended heartbeat cannot reach it.
		const r = await reg.executeTool(PROBE, {}, { emit: () => {}, principal: unattendedPrincipal('heartbeat', [PROBE], 'heartbeat') });
		expect(r.success).toBe(false);
		expect(ran).toBe(false);
	});
});

describe('unattended principals and the reclassified writers', () => {
	it('refuses forget_memory to a heartbeat principal that does not list it, before the handler runs', async () => {
		const r = await reg.executeTool('forget_memory', { id: 'mem-x' }, { emit: () => {}, principal: unattendedPrincipal('heartbeat', undefined, 'heartbeat') });
		expect(r).toMatchObject({ success: false });
		expect(r.error).toMatch(/changes something/);
	});

	it('refuses an unlisted writer to a headless MCP or service caller', async () => {
		for (const name of ['followup_schedule', 'write_document', 'update_tool']) {
			const r = await reg.executeTool(name, {}, { emit: () => {}, principal: unattendedPrincipal('mcp') });
			expect(r.success, name).toBe(false);
		}
	});
});

describe('the unattended lists against the declared tiers', () => {
	const byName = () => new Map(reg.getTools().map((t) => [t.name, t]));

	it('offers heartbeat only reads and its own deliberate mutates: home, follow-ups, watchers, schedules', () => {
		const m = byName();
		const offered = reg.getTools().filter((t) => ['followups', 'heartbeat', 'schedule', 'home'].includes(t.toolset));
		expect(offered.filter((t) => declaredTier(t).effect === 'destructive' || declaredTier(t).confirm === 'always')).toEqual([]);
		const mutates = offered.filter((t) => declaredTier(t).effect === 'mutate').map((t) => t.name).sort();
		expect(mutates).toEqual(
			[
				'cancel_scheduled_callback', 'complete_heartbeat_action', 'followup_cancel', 'followup_schedule', 'ha_call_service', 'ha_fire_event',
				'register_heartbeat_action', 'schedule_orchestrator_turn_at', 'schedule_reply_at', 'schedule_tool_call_at',
			].sort(),
		);
		expect(m.get('forget_memory')?.toolset).toBe('memory');
	});

	it('keeps daydream thinking, selfimprove context and the calendar reader on reads', async () => {
		const { PRIVATE_SITE_TOOLS, RESEARCH_SITE_TOOLS } = await import('$lib/daydream/think/tools');
		const m = byName();
		for (const name of [...PRIVATE_SITE_TOOLS, ...RESEARCH_SITE_TOOLS, 'api_secrets_list', 'apple_calendar_list']) {
			expect(declaredTier(m.get(name)!), name).toEqual({ effect: 'read', confirm: 'never', lane: 'standard' });
		}
		// selfimprove discovery lists one mutate on purpose: cataloguing an API it found.
		expect(declaredTier(m.get('api_register')!).effect).toBe('mutate');
	});

	it('will not let an unattended turn defer a tool its own list does not name', async () => {
		const heartbeat = unattendedPrincipal('heartbeat', ['schedule_tool_call_at', 'ha_call_service'], 'heartbeat');
		const r = await reg.executeTool(
			'schedule_tool_call_at',
			{ name: 'launder', tool_name: 'forget_memory', args: { id: 'm' }, in_seconds: 60 },
			{ emit: () => {}, principal: heartbeat },
		);
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/not on that turn's own tool list/);
		const d = await reg.executeTool(
			'schedule_tool_call_at',
			{ name: 'later', tool_name: 'api_call', args: {}, in_seconds: 60 },
			{ emit: () => {}, principal: { principalId: 'owner', via: 'session', attended: true, jobId: 'j' } },
		);
		expect(d.error).toMatch(/needs confirming at call time/);
	});
});
