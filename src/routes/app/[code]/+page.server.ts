import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { qrDataUrl } from '$lib/server/qr';
import type { PageServerLoad } from './$types';
import { APP_COOKIE, appCookie, joinDisplayName, verifyJoinCode } from '$lib/server/adhoc-install';

/**
 * /app/<code> — the link the owner sends one person (`$lib/server/adhoc-install`).
 * Public (`/app` in PUBLIC_PATHS); the code is the permission. On an iPhone
 * it walks through the one-time profile; anywhere else it shows a QR code to
 * open it on the phone. Either way it leaves the cookie that lets /app — the
 * address to come back to — recognise this phone's Safari.
 */
export const load: PageServerLoad = async ({ params, url, request, cookies, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  const slug = verifyJoinCode(params.code, env.AUTH_SECRET);
  if (!slug || !env.AUTH_SECRET) throw error(404, 'This link has expired. Ask John for a new one.');

  cookies.set(APP_COOKIE, appCookie(slug, env.AUTH_SECRET), {
    path: '/',
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 400 * 24 * 60 * 60,
  });

  const ua = request.headers.get('user-agent') ?? '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));
  // Chrome, Firefox and in-app browsers on iOS cannot hand a profile to Settings.
  const safari = ios && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|WhatsApp|Line\//.test(ua);
  const link = `${url.origin}/app/${params.code}`;
  return {
    name: joinDisplayName(slug),
    code: params.code,
    device: safari ? ('safari' as const) : ios ? ('ios-other' as const) : ('elsewhere' as const),
    link,
    qr: ios ? null : await qrDataUrl(link),
  };
};
