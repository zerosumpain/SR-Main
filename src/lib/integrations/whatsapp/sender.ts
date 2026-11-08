/**
 * Who a WhatsApp message is from, and whether they may talk to jkai.
 *
 * Both answers fail CLOSED. They used to fail open twice over:
 *
 * - An empty allow-list admitted everyone. A fresh `whatsapp_config` row, or a
 *   panel save that cleared the list, turned the owner's jkai — his mail, his
 *   memory, his house — into a public number.
 * - A LID sender skipped the check entirely. WhatsApp now addresses most direct
 *   messages by a LID (`…@lid`), an opaque id with no phone number in it, so in
 *   practice nearly every message bypassed the filter. Production's only
 *   WhatsApp thread is keyed by one.
 *
 * A LID is resolved to the phone number it stands for (WhatsApp sends it in the
 * key, and Baileys keeps a LID→PN map) and the NUMBER is checked. A LID that
 * cannot be resolved is refused: nobody can say whose it is.
 *
 * Pure apart from the optional lookup, so the rules are unit-tested without a
 * socket (`sender.test.ts`).
 */

/** Digits only, so "+44 7…", "447…" and "44-7…" compare equal. */
export function normaliseNumber(number: string): string {
	return (number ?? '').replace(/@.*$/, '').split(':')[0].replace(/\D+/g, '');
}

export function normaliseAllowList(numbers: readonly string[]): Set<string> {
	return new Set(numbers.map(normaliseNumber).filter(Boolean));
}

/** An empty list admits nobody. */
export function isAllowedSender(allowed: ReadonlySet<string>, number: string | null | undefined): boolean {
	if (!number || allowed.size === 0) return false;
	const n = normaliseNumber(number);
	return n.length > 0 && allowed.has(n);
}

const PN_SUFFIX = '@s.whatsapp.net';

/** The parts of a Baileys message key this reads. */
export interface SenderKey {
	remoteJid?: string | null;
	remoteJidAlt?: string | null;
	participant?: string | null;
	participantAlt?: string | null;
	senderPn?: string | null;
}

export interface ResolvedSender {
	/** The sender's phone number (digits), or null when it could not be known. */
	number: string | null;
	isLid: boolean;
}

/**
 * The phone number behind a direct message's key.
 *
 * A phone JID is read as is. A LID is resolved from the key's alternate
 * addresses first (Baileys 7 puts the PN JID there for LID-addressed chats),
 * then from `lookupPn` (the socket's LID→PN map). Anything else is unknown.
 */
export async function resolveSender(
	key: SenderKey,
	lookupPn?: (lid: string) => Promise<string | null | undefined>,
): Promise<ResolvedSender> {
	const remoteJid = key.remoteJid ?? '';
	if (!remoteJid.endsWith('@lid')) {
		const number = normaliseNumber(remoteJid);
		return { number: number || null, isLid: false };
	}
	for (const alt of [key.remoteJidAlt, key.senderPn, key.participantAlt, key.participant]) {
		if (alt && alt.endsWith(PN_SUFFIX)) return { number: normaliseNumber(alt), isLid: true };
	}
	if (lookupPn) {
		try {
			const pn = await lookupPn(remoteJid);
			if (pn && pn.endsWith(PN_SUFFIX)) return { number: normaliseNumber(pn), isLid: true };
		} catch {
			// An unreadable map is an unknown sender, not an admitted one.
		}
	}
	return { number: null, isLid: true };
}
