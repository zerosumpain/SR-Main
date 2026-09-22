import { whatsappBridgeUrl } from '$lib/config/whatsapp-bridge';
import { ownsWhatsAppSession } from '$lib/workflows/service-role';
import { postToBridge } from './bridge-send';
import type { WhatsAppSendResult } from './types';

/**
 * Sending one WhatsApp message, without importing the thing that owns the
 * session.
 *
 * `WhatsAppService` is one 480-line class that is two things: a Baileys session
 * owner, and — whenever a bridge URL is set — a `fetch` client that POSTs to the
 * owning process. In production every web slot is the second. Chat only ever
 * calls `sendMessage`, so importing that class put `@whiskeysockets/baileys`,
 * an auth-state store and a reconnect ladder onto chat's runtime graph in order
 * to make an HTTP POST.
 *
 * ## Why this matters more than the weight
 *
 * The class comment says it plainly: a second Baileys client "would fight the
 * owning process for the paired session and loop on failed QR-pair attempts".
 * `ownsWhatsAppSession()` is what keeps that from happening, and it is a runtime
 * check — a process that gets it wrong still has the code to start a session.
 *
 * A chat application in its own repository should not be able to make that
 * mistake at all. It imports this, which can only ever talk to the bridge, and
 * the session owner is behind a dynamic import that the extracted app does not
 * ship. The guarantee stops depending on an environment variable being right.
 *
 * `EXTRACTION.md` step 4 asks for exactly this: "Never run both owners at
 * once."
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<WhatsAppSendResult> {
	const bridgeUrl = ownsWhatsAppSession() ? null : whatsappBridgeUrl();

	if (bridgeUrl) {
		// Deliberately NOT gated on a cached `status`. In delegated mode that
		// value is set once by a boot probe and never re-probed, so any restart
		// during an outage — a CI deploy counts — pinned the channel off
		// permanently even after the owner came back. Attempt the send and report
		// what actually happened.
		return postToBridge(bridgeUrl, to, text);
	}

	// The one path that does not travel. Only the process that OWNS the session
	// reaches this, and an extracted chat application never does — it has no
	// business holding the pairing. Dynamically imported so the class, and
	// Baileys with it, stays off this module's static graph.
	const { getWhatsAppService } = await import('./service');
	return getWhatsAppService().sendMessage(to, text);
}
