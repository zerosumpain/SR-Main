import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unattendedPrincipal } from './in-process-principal';
import type { ToolPrincipal } from './invoke-contract';

/**
 * `ha_call_service` is one tool that can switch a lamp or open the front door.
 * Its per-call tier (`registerCallTier` → `callTier`) is what keeps the second out
 * of reach of every caller that cannot answer a gate: a heartbeat, a WhatsApp
 * reply code and a scheduled callback all list the tool, so the list alone
 * would let them. The refinement is enforced in `executeTool` itself.
 */
const h = vi.hoisted(() => ({ calls: [] as Array<[string, string]>, inserted: [] as unknown[] }));

vi.mock('$lib/integrations/homeassistant/service', () => ({
	getHomeAssistantService: () => ({
		callService: async (domain: string, service: string) => {
			h.calls.push([domain, service]);
			return { success: true, data: [] };
		},
	}),
}));

function chain(rows: unknown[]): unknown {
	const p: unknown = new Proxy(() => {}, {
		get: (_t, k) => (k === 'then' ? (res: (v: unknown) => void) => res(rows) : () => p),
	});
	return p;
}
vi.mock('$lib/db', () => ({
	db: {
		select: () => chain([]),
		insert: () => ({ values: (v: unknown) => (h.inserted.push(v), chain([{ id: 'row-1' }])) }),
		update: () => ({ set: () => chain([]) }),
		execute: async () => ({ rows: [] }),
	},
}));

const reg = await import('./registry');
const { callTier, registerCallTier } = await import('./declared-tier');
const { haCallServiceConfirm } = await import('./tools/home-assistant');
const { replyCodeEligible } = await import('$lib/integrations/whatsapp/reply-code.server');
// As hooks.server.ts registers it at boot.
(await import('./reply-code-runtime')).registerReplyCodeToolRuntime();
const { fireCallback } = await import('$lib/scheduled/executor');
const { heartbeatToolNames } = await import('$lib/heartbeat/llm');

const UNLOCK = { domain: 'lock', service: 'unlock', entity_id: 'lock.front_door' };
const LIGHT_OFF = { domain: 'light', service: 'turn_off', entity_id: 'light.lounge' };
const ATTENDED: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'job-1' };

const run = (args: Record<string, unknown>, principal: ToolPrincipal) =>
	reg.executeTool('ha_call_service', args, { emit: () => {}, principal });

beforeEach(() => {
	h.calls = [];
	h.inserted = [];
});

describe('the per-call tier of ha_call_service', () => {
	it('confirms always outside the safe set, lightly inside it', () => {
		for (const [domain, service] of [
			['lock', 'unlock'], ['alarm_control_panel', 'alarm_disarm'], ['cover', 'open_cover'], ['script', 'turn_on'],
			['automation', 'trigger'], ['shell_command', 'x'], ['homeassistant', 'turn_on'], ['notify', 'mobile_app'],
			['siren', 'turn_on'], ['valve', 'open_valve'], ['input_boolean', 'turn_on'], ['input_text', 'set_value'],
			['switch', 'turn_on'], ['scene', 'apply'], ['scene', 'create'], ['Light', 'turn_on'], ['light/../lock', 'unlock'], ['', ''],
		]) {
			expect(haCallServiceConfirm({ domain, service }), `${domain}.${service}`).toBe('always');
		}
		for (const [domain, service] of [['light', 'turn_off'], ['scene', 'turn_on'], ['climate', 'set_temperature'], ['media_player', 'media_pause'], ['fan', 'turn_on']]) {
			expect(haCallServiceConfirm({ domain, service }), `${domain}.${service}`).toBe('light');
		}
	});

	it('only ever raises the declared tier', () => {
		const tool = reg.getTool('ha_call_service')!;
		expect(callTier(tool, UNLOCK)).toEqual({ effect: 'mutate', confirm: 'always', lane: 'standard' });
		expect(callTier(tool, LIGHT_OFF)).toEqual({ effect: 'mutate', confirm: 'light', lane: 'standard' });
		registerCallTier('call_tier_probe_lower', () => ({ confirm: 'never' }));
		registerCallTier('call_tier_probe_throws', () => { throw new Error('x'); });
		expect(callTier({ name: 'call_tier_probe_lower', effect: 'mutate' }, {}).confirm).toBe('light');
		expect(callTier({ name: 'call_tier_probe_throws', effect: 'read' }, {}).confirm).toBe('always');
	});

	it('refuses a malformed domain or service before Home Assistant is called, even attended', async () => {
		const r = await run({ domain: 'light/../lock', service: 'unlock' }, ATTENDED);
		expect(r.success).toBe(false);
		expect(h.calls).toEqual([]);
	});
});

describe('lock.unlock is out of reach of every caller that cannot confirm', () => {
	it('refuses a heartbeat turn, which lists ha_call_service', async () => {
		const offered = await heartbeatToolNames();
		expect(offered).toContain('ha_call_service');
		expect(offered).not.toContain('ha_fire_event');
		const heartbeat = unattendedPrincipal('heartbeat', offered, 'heartbeat');
		const r = await run(UNLOCK, heartbeat);
		expect(r.success).toBe(false);
		expect(r.error).toMatch(/needs confirming/);
		expect(h.calls).toEqual([]);
		// …and the scheduled "lights off" a heartbeat turn exists for still runs.
		expect((await run(LIGHT_OFF, heartbeat)).success).toBe(true);
		expect(h.calls).toEqual([['light', 'turn_off']]);
	});

	it('refuses a WhatsApp reply code: never eligible, and refused if run anyway', async () => {
		expect(await replyCodeEligible('ha_call_service', UNLOCK)).toBe(false);
		expect(await replyCodeEligible('ha_call_service', LIGHT_OFF)).toBe(true);
		const r = await run(UNLOCK, unattendedPrincipal('whatsapp-reply-code', ['ha_call_service'], 'whatsapp'));
		expect(r.success).toBe(false);
		expect(h.calls).toEqual([]);
	});

	it('refuses a scheduled callback at fire time', async () => {
		const row = {
			id: 'cb-1', name: 'unlock-later', kind: 'tool', conversationId: null,
			payload: { toolName: 'ha_call_service', args: UNLOCK }, totalCostUsd: '0', fireAt: new Date(),
		} as never;
		const res = await fireCallback(row);
		expect(res.ok).toBe(false);
		expect(h.calls).toEqual([]);
	});

	it('still lets John unlock from attended chat', async () => {
		expect((await run(UNLOCK, ATTENDED)).success).toBe(true);
		expect(h.calls).toEqual([['lock', 'unlock']]);
	});
});

describe('schedule_tool_call_at defers only what never confirms', () => {
	const schedule = (toolName: string, args: Record<string, unknown>, principal: ToolPrincipal = ATTENDED) =>
		reg.executeTool('schedule_tool_call_at', { name: `later-${toolName}`, tool_name: toolName, args, in_seconds: 60 }, { emit: () => {}, principal });

	it('refuses a build, an unlock and a trip undo, even from attended chat', async () => {
		await import('$lib/trips/chat-tools');
		for (const [tool, args] of [['build_create', { title: 'x' }], ['ha_call_service', UNLOCK], ['trip_undo', { tripId: 't' }]] as const) {
			const r = await schedule(tool, args);
			expect(r.success, tool).toBe(false);
			expect(r.error, tool).toMatch(/needs confirming at call time/);
		}
		expect(h.inserted).toEqual([]);
	});

	it('refuses a light switch too: a timed change goes through an orchestrator turn', async () => {
		const r = await schedule('ha_call_service', LIGHT_OFF);
		expect(r.error).toMatch(/schedule_orchestrator_turn_at/);
	});

	it('gives the orchestrator turn a light confirm, so an unlisted unattended caller cannot schedule one', async () => {
		expect(callTier(reg.getTool('schedule_orchestrator_turn_at')!, {}).confirm).toBe('light');
		const r = await reg.executeTool(
			'schedule_orchestrator_turn_at',
			{ name: 'x', message: 'unlock the door', in_seconds: 60 },
			{ emit: () => {}, principal: unattendedPrincipal('mcp') },
		);
		expect(r.success).toBe(false);
	});
});
