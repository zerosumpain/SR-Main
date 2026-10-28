import { afterAll, describe, expect, it } from 'vitest';
import {
	coerceCataloguePayload,
	MEMBER_SAFE_TOOLS,
	principalRefusal,
	tierOf,
	type ToolPrincipal,
} from './invoke-contract';
import { createNonceLedger, openPrincipal, sealPrincipal } from './principal-seal';
import { fallbackPrincipal, ownerActionPrincipal, unattendedPrincipal } from './in-process-principal';
import { register, unregister, type ToolExecContext } from './registry-internal';

/**
 * Principal phase 2 and manifest M0, against the REAL `executeTool`: the tier
 * a declaration gets, the seal, and who may reach what. Probe tools are
 * registered here so the cases do not depend on any domain tool's handler.
 */
const { executeTool, getTools } = await import('./registry');

const PROBES = {
	read: 'principal_probe_read',
	mutate: 'principal_probe_mutate',
	quiet: 'principal_probe_mutate_quiet',
	destructive: 'principal_probe_destructive',
	commission: 'principal_probe_commission',
	odd: 'principal_probe_unknown_effect',
} as const;
const ran: string[] = [];
const probe = (name: string, extra: Record<string, unknown>) =>
	register({
		name,
		description: 'principal probe',
		parameters: { type: 'object', properties: {} },
		category: 'Test',
		toolset: 'test',
		handler: async () => {
			ran.push(name);
			return { success: true };
		},
		...extra,
	});
probe(PROBES.read, {});
probe(PROBES.mutate, { effect: 'mutate' });
probe(PROBES.quiet, { effect: 'mutate', confirm: 'never' });
probe(PROBES.destructive, { destructive: true });
probe(PROBES.commission, { effect: 'mutate', lane: 'commission' });
probe(PROBES.odd, { effect: 'teleport' });
afterAll(() => Object.values(PROBES).forEach((n) => unregister(n)));

const ctx = (principal?: ToolPrincipal, extra: Partial<ToolExecContext> = {}): ToolExecContext => ({
	emit: () => {},
	...(principal ? { principal } : {}),
	...extra,
});
const OWNER_ATTENDED: ToolPrincipal = { principalId: 'owner', via: 'session', attended: true, jobId: 'job-1' };
const run = async (name: string, c: ToolExecContext) => {
	ran.length = 0;
	const r = await executeTool(name, {}, c);
	return { ...r, ran: ran.includes(name) };
};

describe('tierOf (manifest M0)', () => {
	it('derives an absent tier from destructive, as every older sender declared it', () => {
		expect(tierOf({})).toEqual({ effect: 'read', confirm: 'never', lane: 'standard' });
		expect(tierOf({ destructive: true })).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
	});

	it('gives a mutate a light confirm unless it says never', () => {
		expect(tierOf({ effect: 'mutate' })).toEqual({ effect: 'mutate', confirm: 'light', lane: 'standard' });
		expect(tierOf({ effect: 'mutate', confirm: 'never' }).confirm).toBe('never');
	});

	it('treats any unknown word as destructive (fails closed)', () => {
		for (const decl of [{ effect: 'teleport' }, { confirm: 'maybe' }, { lane: 'side-door' }, { effect: 7 }]) {
			expect(tierOf(decl)).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
		}
	});

	it('only ratchets up', () => {
		expect(tierOf({ destructive: true, effect: 'read', confirm: 'never', lane: 'standard' })).toEqual({
			effect: 'destructive',
			confirm: 'always',
			lane: 'destructive',
		});
		expect(tierOf({ lane: 'commission' })).toEqual({ effect: 'mutate', confirm: 'always', lane: 'commission' });
	});

	it('is what a receiver reads off the catalogue, with destructive following the tier', () => {
		const payload = coerceCataloguePayload({
			tools: [
				{ name: 'a' },
				{ name: 'b', destructive: true },
				{ name: 'c', effect: 'mutate' },
				{ name: 'd', effect: 'what' },
			],
		});
		expect(payload.tools.map((t) => [t.name, t.effect, t.confirm, t.lane, t.destructive])).toEqual([
			['a', 'read', 'never', 'standard', false],
			['b', 'destructive', 'always', 'destructive', true],
			['c', 'mutate', 'light', 'standard', false],
			['d', 'destructive', 'always', 'destructive', true],
		]);
		expect(payload.skillsIndex).toBe('');
	});
});

describe('the real catalogue', () => {
	const byName = new Map(getTools().map((t) => [t.name, t]));

	it('marks the design’s named mutates', () => {
		for (const name of ['ha_call_service', 'save_memory', 'memory_remember', 'workflow_run', 'build_create', 'build_tweak', 'build_control', 'studio_build']) {
			expect(byName.get(name), name).toBeDefined();
			expect(tierOf(byName.get(name)!), name).toMatchObject({ effect: 'mutate', confirm: 'light', lane: 'standard' });
		}
	});

	it('keeps every destructive tool on the destructive tier', () => {
		for (const t of getTools().filter((x) => x.destructive)) expect(tierOf(t), t.name).toEqual({ effect: 'destructive', confirm: 'always', lane: 'destructive' });
	});

	it('has no tool on the commission lane yet (slice 6b adds develop_commission)', () => {
		expect(getTools().filter((t) => !t.name.startsWith('principal_probe_') && tierOf(t).lane === 'commission').map((t) => t.name)).toEqual([]);
	});

	it('lists only registered read tools as member-safe', () => {
		for (const name of MEMBER_SAFE_TOOLS) {
			expect(byName.get(name), name).toBeDefined();
			expect(tierOf(byName.get(name)!).effect, name).toBe('read');
		}
	});
});

describe('executeTool enforces the principal', () => {
	it('lets an attended owner reach every tier but the commission lane', async () => {
		for (const name of [PROBES.read, PROBES.mutate, PROBES.destructive]) expect((await run(name, ctx(OWNER_ATTENDED))).ran, name).toBe(true);
	});

	it('refuses the commission lane to everyone, the attended owner included', async () => {
		for (const p of [OWNER_ATTENDED, unattendedPrincipal('t', [PROBES.commission]), ownerActionPrincipal('t')]) {
			const r = await run(PROBES.commission, ctx(p));
			expect(r.ran).toBe(false);
			expect(r.error).toMatch(/commission lane/);
		}
	});

	it('never lets an unattended principal reach a destructive tool, even listed', async () => {
		for (const via of ['service', 'heartbeat', 'whatsapp', 'bridge'] as const) {
			const r = await run(PROBES.destructive, ctx(unattendedPrincipal('t', [PROBES.destructive], via)));
			expect(r.ran, via).toBe(false);
			expect(r.error).toMatch(/needs confirming/);
		}
	});

	it('runs an unattended mutate only when its list names it', async () => {
		expect((await run(PROBES.mutate, ctx(unattendedPrincipal('heartbeat', [PROBES.mutate], 'heartbeat')))).ran).toBe(true);
		const r = await run(PROBES.mutate, ctx(unattendedPrincipal('heartbeat', undefined, 'heartbeat')));
		expect(r.ran).toBe(false);
		expect(r.error).toMatch(/lists explicitly/);
		// No card does not mean no rule: a quiet mutate still needs the list.
		expect((await run(PROBES.quiet, ctx(unattendedPrincipal('t')))).ran).toBe(false);
	});

	it('lets unattended principals read', async () => {
		expect((await run(PROBES.read, ctx(unattendedPrincipal('t')))).ran).toBe(true);
	});

	it('gives a member only listed, flagged-read, member-safe tools', async () => {
		const member: ToolPrincipal = { principalId: 'u_kid', via: 'session', attended: true, jobId: 'j', allowedTools: [PROBES.read, PROBES.mutate] };
		// A read tool the member list names is still not on the closed member-safe list.
		expect((await run(PROBES.read, ctx(member))).ran).toBe(false);
		expect((await run(PROBES.mutate, ctx(member))).ran).toBe(false);
		expect((await run(PROBES.read, ctx({ ...member, allowedTools: undefined }))).ran).toBe(false);
	});

	it('treats a call with no principal as unattended service, held to its own list', async () => {
		expect((await run(PROBES.read, ctx())).ran).toBe(true);
		expect((await run(PROBES.mutate, ctx())).ran).toBe(false);
		expect((await run(PROBES.mutate, ctx(undefined, { allowedTools: [PROBES.mutate] }))).ran).toBe(true);
		expect((await run(PROBES.destructive, ctx())).ran).toBe(false);
		expect(fallbackPrincipal({ principalId: 'u_x' })).toMatchObject({ principalId: 'u_x', attended: false });
	});

	it('treats a declaration it cannot read as destructive', async () => {
		expect((await run(PROBES.odd, ctx(unattendedPrincipal('t', [PROBES.odd])))).ran).toBe(false);
		expect((await run(PROBES.odd, ctx(OWNER_ATTENDED))).ran).toBe(true);
	});

	it('counts an owner press as attended', async () => {
		expect((await run(PROBES.destructive, ctx(ownerActionPrincipal('daydream-act')))).ran).toBe(true);
	});
});

describe('principalRefusal on its own', () => {
	const tier = (decl: Record<string, unknown>) => tierOf(decl);
	it('holds a siri or watch turn to the unattended rules, whatever it claims', () => {
		const siri: ToolPrincipal = { ...OWNER_ATTENDED, via: 'device', surface: 'siri' };
		expect(principalRefusal(siri, { name: 'x', tier: tier({ destructive: true }) })).toMatch(/needs confirming/);
		expect(principalRefusal({ ...OWNER_ATTENDED, jobId: undefined }, { name: 'x', tier: tier({ effect: 'mutate' }) })).toMatch(/explicitly/);
	});
});

describe('the seal', () => {
	const KEY = 'k'.repeat(40);
	const opts = { key: KEY, aud: 'sr-main' as const, tool: 'site_blog_list' };

	it('round-trips, recomputing attended', () => {
		const s = sealPrincipal({ principalId: 'owner', via: 'whatsapp', attended: true, jobId: 'j' }, opts)!;
		const v = openPrincipal(s, opts);
		expect(v.ok && v.claims).toMatchObject({ principalId: 'owner', via: 'whatsapp', attended: false, aud: 'sr-main', tool: 'site_blog_list' });
	});

	it('does not seal with a short or missing key, and does not open without one', () => {
		expect(sealPrincipal(OWNER_ATTENDED, { ...opts, key: 'short' })).toBeNull();
		expect(sealPrincipal(OWNER_ATTENDED, { ...opts, key: undefined })).toBeNull();
		expect(openPrincipal('x.y', { ...opts, key: undefined })).toEqual({ ok: false, reason: 'unconfigured' });
	});

	it('refuses a lifetime longer than the receiver allows, even if signed', () => {
		const s = sealPrincipal(OWNER_ATTENDED, { ...opts, ttlMs: 60 * 60_000 })!;
		// The issuer caps it; a hand-built long-lived claim fails the cap at open.
		expect(openPrincipal(s, opts).ok).toBe(true);
		expect(openPrincipal(s, { ...opts, now: Date.now() + 10 * 60_000 })).toEqual({ ok: false, reason: 'expired' });
	});

	it('refuses a replay through the ledger', () => {
		const ledger = createNonceLedger();
		const s = sealPrincipal(OWNER_ATTENDED, opts)!;
		expect(openPrincipal(s, { ...opts, ledger }).ok).toBe(true);
		expect(openPrincipal(s, { ...opts, ledger })).toEqual({ ok: false, reason: 'replay' });
	});

	it('refuses malformed input without throwing', () => {
		for (const bad of ['', 'nodot', 'a.b.c', `${Buffer.from('{').toString('base64url')}.${'A'.repeat(43)}`]) {
			expect(openPrincipal(bad, opts).ok).toBe(false);
		}
	});
});
