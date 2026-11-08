import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	coercePrincipalClaims,
	normalisePrincipal,
	PRINCIPAL_CLOCK_SKEW_MS,
	PRINCIPAL_KEY_MIN_LENGTH,
	PRINCIPAL_MAX_TTL_MS,
	PRINCIPAL_TTL_MS,
	type PrincipalAudience,
	type PrincipalClaims,
	type ToolPrincipal,
} from './invoke-contract';

/**
 * Sealing and opening a tool-call principal (principal phase 2).
 *
 * Byte-identical in SR-Main, SR-Jkai-Core and SR-Workflows, like the contract
 * it reads. The chat processes seal; Main opens. One HMAC-SHA256 over the
 * base64url claims with `JKAI_PRINCIPAL_KEY` — deliberately its own key, never
 * an invoke token, so holding the destructive token does not let a caller
 * speak for the owner.
 *
 * The key is an ARGUMENT, not read here: no environment, so each side's tests
 * run the real code, and the file stays identical across three repositories
 * with three different `$env` aliases.
 *
 * Each seal names one receiver (`aud`), one tool, and lives for two minutes.
 * A receiver also keeps the nonces it has seen until they expire, so a seal
 * captured off the wire opens nothing a second time.
 */

const DOMAIN = 'sr-principal-v1.';

function mac(key: string, body: string): string {
	return createHmac('sha256', key).update(DOMAIN + body).digest('base64url');
}

export function principalKeyUsable(key: string | undefined | null): key is string {
	return typeof key === 'string' && key.length >= PRINCIPAL_KEY_MIN_LENGTH;
}

/**
 * Seal `principal` for one call of `tool` to `aud`. Null when the key is
 * unusable: the caller then sends no principal, and the receiver refuses.
 */
export function sealPrincipal(
	principal: ToolPrincipal,
	opts: { key: string | undefined | null; aud: PrincipalAudience; tool: string; now?: number; ttlMs?: number },
): string | null {
	if (!principalKeyUsable(opts.key)) return null;
	const now = opts.now ?? Date.now();
	const p = normalisePrincipal(principal);
	const claims: PrincipalClaims = {
		v: 1,
		aud: opts.aud,
		tool: opts.tool,
		principalId: p.principalId,
		via: p.via,
		attended: p.attended,
		...(p.jobId ? { jobId: p.jobId } : {}),
		...(p.surface ? { surface: p.surface } : {}),
		...(p.deviceId ? { deviceId: p.deviceId } : {}),
		...(p.allowedTools ? { allowedTools: [...p.allowedTools] } : {}),
		...(p.purpose ? { purpose: p.purpose } : {}),
		iat: now,
		exp: now + Math.min(opts.ttlMs ?? PRINCIPAL_TTL_MS, PRINCIPAL_MAX_TTL_MS),
		nonce: randomBytes(18).toString('base64url'),
	};
	const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
	return `${body}.${mac(opts.key, body)}`;
}

export type PrincipalVerdict =
	| { ok: true; claims: PrincipalClaims }
	| { ok: false; reason: 'unconfigured' | 'missing' | 'malformed' | 'signature' | 'expired' | 'audience' | 'tool' | 'replay' };

/** Remembers nonces until their seal expires; bounded so it cannot grow without end. */
export function createNonceLedger(max = 20_000): { claim(nonce: string, exp: number, now?: number): boolean } {
	const seen = new Map<string, number>();
	return {
		claim(nonce, exp, now = Date.now()) {
			if (seen.size >= max) {
				for (const [n, e] of seen) if (e + PRINCIPAL_CLOCK_SKEW_MS < now) seen.delete(n);
				// Still full of live seals: refuse rather than forget one.
				if (seen.size >= max) return false;
			}
			if (seen.has(nonce)) return false;
			seen.set(nonce, exp);
			return true;
		},
	};
}

/**
 * Open a seal: constant-time signature, then audience, tool, lifetime and
 * (with a ledger) single use. The claims come back normalised, so "attended"
 * is recomputed here rather than taken on the issuer's word.
 */
export function openPrincipal(
	sealed: string | undefined | null,
	opts: {
		key: string | undefined | null;
		aud: PrincipalAudience;
		tool: string;
		now?: number;
		ledger?: { claim(nonce: string, exp: number, now?: number): boolean };
	},
): PrincipalVerdict {
	if (!principalKeyUsable(opts.key)) return { ok: false, reason: 'unconfigured' };
	if (!sealed) return { ok: false, reason: 'missing' };
	const dot = sealed.indexOf('.');
	if (dot <= 0 || dot !== sealed.lastIndexOf('.')) return { ok: false, reason: 'malformed' };
	const body = sealed.slice(0, dot);
	const given = Buffer.from(sealed.slice(dot + 1));
	const expected = Buffer.from(mac(opts.key, body));
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };
	let raw: unknown;
	try {
		raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	const claims = coercePrincipalClaims(raw);
	if (!claims) return { ok: false, reason: 'malformed' };
	if (claims.aud !== opts.aud) return { ok: false, reason: 'audience' };
	if (claims.tool !== opts.tool) return { ok: false, reason: 'tool' };
	const now = opts.now ?? Date.now();
	if (
		claims.exp <= claims.iat ||
		claims.exp - claims.iat > PRINCIPAL_MAX_TTL_MS ||
		claims.iat > now + PRINCIPAL_CLOCK_SKEW_MS ||
		claims.exp + PRINCIPAL_CLOCK_SKEW_MS < now
	) {
		return { ok: false, reason: 'expired' };
	}
	if (opts.ledger && !opts.ledger.claim(claims.nonce, claims.exp, now)) return { ok: false, reason: 'replay' };
	return { ok: true, claims: { ...claims, ...normalisePrincipal(claims) } };
}
