import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import os from 'node:os';
import {
  canManageHermes,
  IS_HOMESERV,
  rWhatsAppStatus,
  rWhatsAppPairState,
  rWhatsAppPair,
  rWhatsAppAction,
} from '$lib/server/hermes-remote';
import { isWhatsAppAction } from '$lib/server/hermes-whatsapp';

/**
 * WhatsApp bridge control. Owner-gated with the rest of /admin by hooks.
 *
 * Everything real happens on homeserv — the session directory, the bridge
 * process and the systemd unit are all there. On the VPS these calls proxy over
 * Tailscale, which is the whole point: the moment you notice WhatsApp is down
 * is exactly the moment you are not sitting at homeserv.
 *
 * Like /admin/connections, the controls are form actions rather than a new API
 * route, so they inherit this page's gate and add no authenticated surface.
 */
export const load: PageServerLoad = async () => {
  const manage = canManageHermes();
  const [status, pair] = await Promise.all([
    manage ? rWhatsAppStatus().catch((e: unknown) => ({ error: String(e) })) : Promise.resolve(null),
    manage ? rWhatsAppPairState().catch(() => null) : Promise.resolve(null),
  ]);

  return {
    status: status && 'error' in status ? null : status,
    loadError: status && 'error' in status ? status.error : null,
    pair,
    canManage: manage,
    direct: IS_HOMESERV,
    hostname: os.hostname(),
  };
};

function gate() {
  return canManageHermes()
    ? null
    : fail(403, {
        ok: false,
        error: `WhatsApp control unavailable from host "${os.hostname()}" — no homeserv route configured.`,
      });
}

export const actions: Actions = {
  /** Kick off a pairing run. Returns immediately; the page polls for the QR. */
  startPair: async () => {
    const blocked = gate();
    if (blocked) return blocked;
    try {
      return { ok: true, pair: await rWhatsAppPair('start') };
    } catch (err) {
      return fail(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  /**
   * Poll for the current QR. Called on a short timer while pairing is live —
   * WhatsApp rotates the code roughly every 20 seconds, so a static render
   * would be stale before it could be scanned.
   */
  pollPair: async () => {
    const blocked = gate();
    if (blocked) return blocked;
    try {
      return { ok: true, pair: await rWhatsAppPairState() };
    } catch (err) {
      return fail(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  cancelPair: async () => {
    const blocked = gate();
    if (blocked) return blocked;
    try {
      return { ok: true, pair: await rWhatsAppPair('cancel') };
    } catch (err) {
      return fail(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  /** restart_bridge / reset_session — both restart Hermes, so both are slow. */
  repair: async ({ request }) => {
    const blocked = gate();
    if (blocked) return blocked;
    const f = await request.formData();
    const action = String(f.get('action') ?? '');
    if (!isWhatsAppAction(action)) return fail(400, { ok: false, error: 'unknown action' });
    try {
      const result = await rWhatsAppAction(action);
      return result.ok ? { ok: true, message: result.message } : fail(500, { ok: false, error: result.message });
    } catch (err) {
      return fail(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
};
