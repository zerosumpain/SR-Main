import { json } from '@sveltejs/kit';
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
  return json({
    code,
    expiresAt: expiresAt.toISOString(),
    payload: JSON.stringify({
      type: 'sr-native-pair',
      version: 1,
      server: url.origin,
      code,
    }),
  });
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
