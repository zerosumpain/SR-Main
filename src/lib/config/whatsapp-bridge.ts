// Where the process that OWNS the WhatsApp session is listening.
//
// In production that is `packages/jkai-wa-worker` on the VPS (port 3110): a
// separate process precisely so a deploy does not drop the socket. The web app
// is DELEGATED — it holds no socket of its own and forwards every send there.
//
// The variable was called `WHATSAPP_HERMES_BRIDGE_URL` when the Hermes gateway
// held the session. Hermes is gone, the worker serves the same contract
// (/health /send /typing /send-media /qr), and the name is the last thing
// pointing at a process that no longer exists.
//
// The old name is read SECOND rather than dropped: a deploy and an `.env` edit
// do not land at the same instant, and an unset bridge URL does not fail loudly
// — it makes the web app think it owns a session it does not have, and outbound
// WhatsApp stops without an error. Delete the fallback once both hosts carry
// `WHATSAPP_BRIDGE_URL`.

/**
 * The bridge URL as configured, trailing slash stripped, or null when unset.
 *
 * Deliberately NOT the delegation decision — the process that owns the session
 * reads the same EnvironmentFile and would otherwise forward its sends to
 * itself. Callers must gate on `ownsWhatsAppSession()` as well.
 */
export function whatsappBridgeUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.WHATSAPP_BRIDGE_URL ?? env.WHATSAPP_HERMES_BRIDGE_URL ?? '';
  return raw ? raw.replace(/\/+$/, '') : null;
}
