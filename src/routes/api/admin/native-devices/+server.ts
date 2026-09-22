import { json } from '@sveltejs/kit';
import QRCode from 'qrcode';
import type { RequestHandler } from './$types';
import { createPairingCode, listDevices, revokeDevice } from '$lib/server/native-auth';

/**
 * Managing the phones that may reach `/api/native/*`.
 *
 * This lives under `/api/admin` and NOT under `/api/native`, deliberately. The
 * native tree is exempted from the session gate in `hooks.server.ts`; an
 * endpoint that mints credentials is the last thing that should sit behind that
 * exemption. Here it takes the ordinary owner gate — a Google session on the
 * allow-list — which is exactly the authority a pairing code delegates to a
 * phone, so the code cannot grant more than the browser that asked for it.
 */

/** GET — the device list. Never carries a token, only a hash's worth of facts. */
export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email) return json({ error: 'Unauthorized' }, { status: 401 });
  return json({ devices: await listDevices(email) });
};

/**
 * POST — mint a one-time pairing code.
 *
 * The response carries the code itself; it is the only moment it exists in
 * plaintext anywhere. The QR payload is assembled here rather than in the page
 * so its shape is owned by one file, and it matches the companion pilot's
 * `sr-companion-pair` envelope so the app's existing scanner already parses it.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email) return json({ error: 'Unauthorized' }, { status: 401 });

  const { code, expiresAt } = await createPairingCode(email);
  const payload = JSON.stringify({
    type: 'sr-native-pair',
    version: 1,
    server: url.origin,
    code,
  });

  // The QR is rendered HERE, server-side, and handed over as a data URL.
  //
  // The page that shows it is the companion dashboard at /apple-app, which is
  // served by a different process on the same hostname. Returning only the
  // payload would mean that page needs a QR library, and its CSP is
  // `script-src 'self'` — so the library would have to be vendored into the
  // pilot, which is the one thing worth avoiding here: the pilot server has no
  // business handling a credential that opens chat and the whole news desk.
  // A data URL crosses as an image, under that page's `img-src 'self' data:`,
  // and the token itself never reaches the pilot's server at all.
  const qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 4, scale: 6 });

  return json({ code, expiresAt: expiresAt.toISOString(), payload, qr });
};

/** DELETE — revoke one device immediately. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  const session = await locals.auth();
  const email = session?.user?.email;
  if (!email) return json({ error: 'Unauthorized' }, { status: 401 });

  const id = url.searchParams.get('id') ?? '';
  if (!id) return json({ error: 'Which device?' }, { status: 400 });

  const revoked = await revokeDevice(email, id);
  if (!revoked) return json({ error: 'That device is already revoked.' }, { status: 404 });
  return json({ revoked: true });
};
