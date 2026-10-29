import { createHash } from 'node:crypto';
import { openPrincipal } from '$lib/tools/principal-seal';
import { coercePrincipalClaims, type InvokeContext, type PrincipalClaims } from '$lib/tools/invoke-contract';

/**
 * Who an invoke-route call is for, from its seal — and what to do while the
 * issuers are still catching up.
 *
 * `JKAI_PRINCIPAL_ENFORCE`:
 * - 'on': every call needs a valid seal (missing → 401, key unset → 503).
 * - 'log' (the default for one release): a MISSING seal, or an unset key, is
 *   logged and the call is read from its body as before — but always as an
 *   UNATTENDED service principal, so `executeTool` still refuses everything
 *   that confirms, anything destructive, the commission lane, and any mutate
 *   the body's own list does not name. A seal that is present but forged,
 *   expired, replayed, for another receiver or another tool is ALWAYS
 *   refused, in both modes: grace covers an issuer that does not sign yet,
 *   never one that signs wrongly.
 *
 * Optional bindings a seal may carry (Main verifies them when present; Core's
 * issuer does not add them yet): `conversationId`, which must equal the body's,
 * and `argsHash` (`principalArgsHash`), which must equal this call's. They ride
 * inside the signed payload, so they are read from it after the signature has
 * been checked; the shared `coercePrincipalClaims` drops unknown fields.
 *
 * PURE apart from the ledger it is handed and the clock.
 */
export type PrincipalEnforceMode = 'log' | 'on';

export function principalEnforceMode(raw: string | undefined | null): PrincipalEnforceMode {
	return (raw ?? '').trim().toLowerCase() === 'on' ? 'on' : 'log';
}

/** Key-order-independent JSON, so issuer and receiver hash the same bytes. */
function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.filter((k) => o[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(v ?? null);
}

/** What an issuer seals as `argsHash`: hex SHA-256 of `<tool>\n<canonical args>`. */
export function principalArgsHash(tool: string, args: Record<string, unknown>): string {
	return createHash('sha256').update(`${tool}\n${canonical(args)}`).digest('hex');
}

export type PrincipalIntake =
	| { ok: true; claims: PrincipalClaims; sealed: boolean; jobId: string | undefined; notes: string[] }
	| { ok: false; status: 401 | 503; message: string };

export function intakePrincipal(input: {
	tool: string;
	args: Record<string, unknown>;
	context: InvokeContext;
	key: string | undefined | null;
	mode: PrincipalEnforceMode;
	ledger: { claim(nonce: string, exp: number, now?: number): boolean };
	now?: number;
}): PrincipalIntake {
	const { tool, args, context, mode } = input;
	const verdict = openPrincipal(context.principal, { key: input.key, aud: 'sr-main', tool, ledger: input.ledger, now: input.now });
	if (!verdict.ok) {
		const graceable = verdict.reason === 'missing' || (verdict.reason === 'unconfigured' && !context.principal);
		if (mode === 'log' && graceable) {
			const now = input.now ?? Date.now();
			const claims: PrincipalClaims = {
				v: 1,
				aud: 'sr-main',
				tool,
				// The old body principal, never attended: nobody vouched for it.
				principalId: typeof context.principalId === 'string' && context.principalId ? context.principalId : 'owner',
				via: 'service',
				attended: false,
				...(context.allowedTools ? { allowedTools: [...context.allowedTools] } : {}),
				...(context.surface ? { surface: context.surface } : {}),
				purpose: 'unsealed',
				iat: now,
				exp: now,
				nonce: 'unsealed-grace-mode',
			};
			return { ok: true, claims, sealed: false, jobId: context.jobId, notes: [`unsealed (${verdict.reason}) accepted as unattended in log mode`] };
		}
		// An unset key with a seal present cannot be checked either way.
		if (verdict.reason === 'unconfigured') return { ok: false, status: 503, message: 'principal key is not configured' };
		return { ok: false, status: 401, message: `principal ${verdict.reason}` };
	}
	const claims = verdict.claims;
	const notes: string[] = [];
	if (claims.jobId && context.jobId && claims.jobId !== context.jobId) {
		return { ok: false, status: 401, message: 'principal does not match the call' };
	}
	// A job the seal does not name is not the caller's to claim: the job id
	// addresses the confirmer and the credential requester of a live turn.
	let jobId = claims.jobId ?? context.jobId;
	if (!claims.jobId && context.jobId) {
		if (mode === 'on') return { ok: false, status: 401, message: 'principal names no job, but the call does' };
		notes.push('body jobId without a sealed one dropped in log mode');
		jobId = undefined;
	}
	const bound = sealedBindings(context.principal!);
	if (bound.conversationId !== undefined && bound.conversationId !== (context.conversationId ?? null)) {
		return { ok: false, status: 401, message: 'principal is for another conversation' };
	}
	if (bound.argsHash !== undefined && bound.argsHash !== principalArgsHash(tool, args)) {
		return { ok: false, status: 401, message: 'principal is for other arguments' };
	}
	// Belt and braces: the shared reader already validated the claims.
	if (!coercePrincipalClaims(claims)) return { ok: false, status: 401, message: 'principal malformed' };
	return { ok: true, claims, sealed: true, jobId, notes };
}

/** The optional bindings from a seal whose signature has ALREADY been verified. */
function sealedBindings(sealed: string): { conversationId?: string | null; argsHash?: string } {
	try {
		const raw = JSON.parse(Buffer.from(sealed.slice(0, sealed.indexOf('.')), 'base64url').toString('utf8')) as Record<string, unknown>;
		const out: { conversationId?: string | null; argsHash?: string } = {};
		if (typeof raw.conversationId === 'string' || raw.conversationId === null) out.conversationId = raw.conversationId as string | null;
		else if (raw.conversationId !== undefined) out.conversationId = '\u0000invalid';
		if (typeof raw.argsHash === 'string') out.argsHash = raw.argsHash;
		else if (raw.argsHash !== undefined) out.argsHash = '\u0000invalid';
		return out;
	} catch {
		return { argsHash: '\u0000invalid' };
	}
}
