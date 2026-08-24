import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';
import { ownsWhatsAppSession } from '$lib/workflows/service-role';

/**
 * WhatsApp pairing status, and the QR when one is waiting.
 *
 * Pairing used to happen entirely inside Hermes, so the site never had a screen
 * for it — which is fine right up until the moment the session moves and there
 * is nowhere to scan.
 *
 * The web app is normally DELEGATED: it holds no socket of its own, so the QR
 * lives in whichever process does. That process serves `/qr`, so this proxies to
 * it rather than reporting a local status that is structurally always empty.
 */
export const GET: RequestHandler = async () => {
  const bridgeUrl = !ownsWhatsAppSession() ? (env.WHATSAPP_HERMES_BRIDGE_URL ?? '') : '';

  if (bridgeUrl) {
    const base = bridgeUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/qr`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        // The Hermes bridge has no /qr — it never needed one. Fall back to its
        // health so the page can still say whether WhatsApp is up.
        const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        const hj = h && h.ok ? ((await h.json()) as { status?: string }) : null;
        return json({
          source: 'bridge',
          status: hj?.status ?? 'unknown',
          qr: null,
          note: 'this bridge does not expose a QR endpoint — pairing happens where the session lives',
        });
      }
      const body = (await res.json()) as { status?: string; qr?: string | null };
      return json({ source: 'bridge', status: body.status ?? 'unknown', qr: body.qr ?? null });
    } catch (err) {
      return json({
        source: 'bridge',
        status: 'unreachable',
        qr: null,
        error: err instanceof Error ? err.message : 'bridge unreachable',
      });
    }
  }

  const s = getWhatsAppService().getState();
  return json({ source: 'local', status: s.status, qr: s.qrCode ?? null, connectedNumber: s.connectedNumber ?? null });
};
