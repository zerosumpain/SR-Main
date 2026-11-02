import type { RequestHandler } from './$types';
import { partyBody, partyJson, requireTv } from '$lib/games/party-http.server';
import { openParty, tvAct } from '$lib/games/party.server';
import { qrDataUrl } from '$lib/server/qr';

/**
 * GET /api/games/tv/party — the linked TV's party (opened if it has none),
 * with the QR a phone scans to join it. POST `{ action, … }` — the TV's
 * verbs (`$lib/games/party.server` tvAct). 401 for anything but a linked TV.
 */
export const GET: RequestHandler = ({ cookies, url }) =>
  partyJson(async () => {
    const tv = await requireTv(cookies);
    const party = openParty(tv);
    return { party, joinUrl: `${url.origin}${party.joinPath}`, qr: await qrDataUrl(`${url.origin}${party.joinPath}`) };
  });

export const POST: RequestHandler = ({ cookies, request, url }) =>
  partyJson(async () => {
    const tv = await requireTv(cookies);
    const body = await partyBody(request);
    const party = tvAct(tv.id, body.action, body);
    return { party, joinUrl: `${url.origin}${party.joinPath}`, qr: await qrDataUrl(`${url.origin}${party.joinPath}`) };
  });
