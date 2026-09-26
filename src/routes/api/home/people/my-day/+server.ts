import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownDayOf } from '$lib/home/presence/my-day';
import { dayWindowFor } from '$lib/home/presence/day-timeline';
import { pilotDay, pilotFailureText } from '$lib/home/presence/companion-accounts';

// GET /api/home/people/my-day?date=YYYY-MM-DD&tz=<getTimezoneOffset()>
//
// The signed-in person's OWN day from the iPhone app — track and health — for
// the "Your day" section on their /home/people page. Keyed on the session
// email and nothing else: there is no subject or email parameter, and any
// parameter beyond `date` and `tz` is refused, so the request cannot be
// pointed at anybody else. Reached by the owner and by `family:circle`
// ($lib/access/catalogue); `ownDayOf` refuses anyone else again here.

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async (event) => {
  const own = await ownDayOf(event);
  if (!own) return json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE });

  const params = event.url.searchParams;
  if ([...params.keys()].some((k) => k !== 'date' && k !== 'tz')) {
    return json({ error: 'Only your own day can be read' }, { status: 400, headers: PRIVATE });
  }
  const window = dayWindowFor(params.get('date'), params.get('tz'), Math.floor(Date.now() / 1000));
  if (!window.ok) return json({ error: window.error }, { status: 400, headers: PRIVATE });

  const r = await pilotDay(own.email, window);
  if (!r.ok) {
    // No account on the app server is an answer, not a fault: they have not paired.
    if (r.reason === 'not-found') return json({ error: 'no-account' }, { status: 404, headers: PRIVATE });
    const status = r.reason === 'unconfigured' ? 503 : 502;
    return json({ error: pilotFailureText(r.reason) }, { status, headers: PRIVATE });
  }
  return json({ date: window.date, tz: window.tz, ...r.value }, { headers: PRIVATE });
};
