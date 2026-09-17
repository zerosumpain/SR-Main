import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * The service credential for `POST /api/platform/tools/invoke` — the lane a
 * chat process outside Main uses to run Main's tools.
 *
 * ## Why there are two tokens
 *
 * 140 of the tools chat can call belong to Main domains, and 25 of those are
 * declared `destructive` — `gmail_send`, `whatsapp_send`, `publish_page`,
 * `node_builder_commit_and_deploy` and the rest. Chat's confirmation gate does
 * NOT move across the boundary: it stays where the human is. So what Main would
 * be trusting on a destructive call is SR-JKAI's assertion that a human
 * approved, not a human.
 *
 * Main cannot verify that itself. It has no session for the person, and any
 * ticket it asked SR-JKAI to present, SR-JKAI can mint without one. A second
 * round trip would add moving parts and buy nothing.
 *
 * So the lane is split, and the destructive half is CLOSED unless deliberately
 * opened:
 *
 *   JKAI_INVOKE_TOKEN              — the 118 non-destructive Main tools
 *   JKAI_INVOKE_DESTRUCTIVE_TOKEN  — additionally the 25 destructive ones
 *
 * Unset means the lane does not exist. With the second unset — the default, and
 * what production ships with — those 25 keep working exactly as they do today,
 * in-process, and chat degrades across the boundary to a message it already
 * has. Opening them is one environment variable and no deploy of code, which is
 * what makes this the reversible option.
 *
 * ## Why it is not loopback-gated
 *
 * The same reason `studio-auth` is not, and there is an outage behind it. On
 * this VPS every request arrives through cloudflared and therefore appears to
 * come from 127.0.0.1 — the property that turned `AUTH_BYPASS=1` into a public
 * `/admin` exposure on 2026-07-24. Loopback is not a security property here, and
 * pairing it with a secret would imply a protection that does not exist. The
 * token alone is the control, which is why the length floor is not optional.
 */
const MIN_TOKEN_LEN = 32;

export type InvokeLane = 'none' | 'standard' | 'destructive';

function presentedToken(request: Request): string {
	const header = request.headers.get('authorization') ?? '';
	return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function matches(provided: string, secret: string | undefined): boolean {
	// Unset, or set to something too short to be a credential, means the door
	// does not exist. No default, no dev fallback.
	if (!secret || secret.length < MIN_TOKEN_LEN) return false;
	// Length first: `timingSafeEqual` throws on unequal buffers, and the throw
	// is itself an oracle. The early return leaks length only, never content.
	if (!provided || provided.length !== secret.length) return false;
	try {
		return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
	} catch {
		return false;
	}
}

/**
 * Which lane this request's credential opens.
 *
 * The destructive token is checked first so that setting both variables to the
 * same string — a misconfiguration, but one that should not be ambiguous —
 * resolves to the wider lane rather than to whichever comparison ran first.
 */
export function invokeLaneFor(request: Request): InvokeLane {
	const provided = presentedToken(request);
	if (!provided) return 'none';
	if (matches(provided, env.JKAI_INVOKE_DESTRUCTIVE_TOKEN)) return 'destructive';
	if (matches(provided, env.JKAI_INVOKE_TOKEN)) return 'standard';
	return 'none';
}

/**
 * Is this SR-JKAI calling, at all?
 *
 * The two-lane split above is about what the caller may DO — the destructive
 * tools — not about who it is. An endpoint that only needs "this is the chat
 * application and not the internet" asks this instead, and either lane answers
 * it. A third credential for the same caller would be one more thing to rotate
 * and one more way for the halves to disagree about who is on the other end.
 */
export function hasJkaiServiceToken(request: Request): boolean {
	return invokeLaneFor(request) !== 'none';
}
