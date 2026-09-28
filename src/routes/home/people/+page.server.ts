import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { errMsg } from '$lib/home/presence/types';
import { livePositions, loadHousehold, type LivePosition } from '$lib/home/presence/household';
import { loadFeedChecks, type FeedCheck } from '$lib/home/presence/feed-checks';
import { listMembers } from '$lib/home/presence/members';
import { loadPeopleMovement, type PersonMovement } from '$lib/home/presence/movement';
import { ownDayOf } from '$lib/home/presence/my-day';
import { DEFAULT_WINDOW_DAYS } from '$lib/home/presence/stats';

/** History windows the filter bar offers; the forecast reads the chosen one. */
const WINDOWS = [7, 28, 90] as const;
const DEFAULT_FORECAST_DAYS = 28;
import {
  mayOpenPerson,
  peopleViewerOf,
  personLinks,
  scopeHousehold,
  type PeopleViewer,
  type ScopedPresence,
} from '$lib/home/presence/viewer';

// The household room. Everyone who may open it — the owner and a household
// viewer — loads the same live cards through the same path, and
// `scopeHousehold` decides what each receives: the owner every card
// untouched; a household viewer everyone's live status, their own day, and
// nothing of anyone not sharing.
//
// Scoping is decided HERE and nowhere else (spec D2). The page cannot be
// trusted to hide anything: whatever this returns is in the browser.
//
// Everyone's movement is on this page too, filtered by `?person=` — the one
// page replaced a page per person (the old /home/people/[subject] forwards
// here). Movement goes only to people `mayOpenPerson` allows: the owner
// everyone's, a household viewer their own and their wards'. A `person` this
// viewer may not see is ignored, never an error, so the filter cannot be used
// to list the household.
interface Family {
  members: ScopedPresence[];
}

const EMPTY = (): Family => ({ members: [] });

/** Person pages this viewer may open — the page links only these. */
const linksFor = (family: Family, viewer: PeopleViewer): Record<string, string> =>
  personLinks(
    family.members.map((m) => m.subject),
    viewer,
  );

export const load: PageServerLoad = async (event) => {
  // The hook already turned away anyone who is neither; this is the second
  // lock, and the one that decides WHAT they get. Nothing is read before it.
  const viewer: PeopleViewer | null = await peopleViewerOf(event);
  if (!viewer) error(403, 'Forbidden');
  event.depends('home:people');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const askedDays = Number(event.url.searchParams.get('days'));
  const days = (WINDOWS as readonly number[]).includes(askedDays) ? askedDays : DEFAULT_FORECAST_DAYS;
  // A person this viewer may not open is ignored, as for the movement below.
  const askedPerson = event.url.searchParams.get('person');
  const forecastPerson = askedPerson && mayOpenPerson(viewer, askedPerson) ? askedPerson : null;
  const isOwner = viewer.kind === 'owner';

  // The forecast — routines, next moves, what looks off, the departure
  // pattern — streamed: the live band must not wait on a month of trail.
  // Scoped inside (`insightMembers`): a household viewer's forecast holds
  // only themselves and their wards. A failure is null, drawn as "unavailable",
  // never as an empty (and so reassuring) forecast.
  const read = import('$lib/home/presence/forecast.server').then((m) => m.loadForecast(viewer, days, forecastPerson));
  // One analysis feeds both the forecast and the agenda; a rejection is
  // handled on each branch, so neither can surface as unhandled.
  read.catch(() => {});
  const forecast = read
    .then(({ forecast, insights, homeId }) => ({
      forecast,
      homeId,
      // Only routes with three clean trips are drawn; the rest (one-offs,
      // most of the ~180) stay on the server.
      routes: insights.routes.filter((r) => r.samples - r.broken >= 3),
      people: insights.people.map((p) => ({ subject: p.subject, displayName: p.displayName, coverage: p.coverage })),
    }))
    .catch((err) => {
      console.error('[home/people] forecast failed:', errMsg(err));
      return null;
    });
  // Coming up: the owner's calendar over the learned routes. Owner only —
  // it is the owner's calendar credential, and it names where people will be.
  const agenda = isOwner
    ? read
        .then(async ({ insights, homeId }) => {
          const { loadAgenda } = await import('$lib/home/presence/agenda.server');
          return loadAgenda({ routes: insights.routes, live: insights.live, homeId });
        })
        .catch((err) => {
          console.error('[home/people] agenda failed:', errMsg(err));
          return null;
        })
    : null;
  // Which travel-desk nudges reach the owner's phone. Owner only.
  const notify = isOwner
    ? await import('$lib/home/presence/watch-alerts.server')
        .then(async (m) => ({ settings: await m.loadNotifySettings(), labels: m.NOTIFY_LABELS }))
        .catch(() => null)
    : null;
  // Places worth naming, by the time actually spent there. Owner only: it
  // names where everyone has been.
  const naming = isOwner
    ? import('$lib/home/presence/naming.server')
        .then(async (m) => ({ queue: await m.loadNamingQueue(days), unnamed: await m.unnamedCount() }))
        .catch((err) => {
          console.error('[home/people] naming queue failed:', errMsg(err));
          return null;
        })
    : null;

  // The map: every SHARING person's last fix (`livePositions` drops anyone not
  // sharing). The owner and any household viewer — that is what the Family
  // Circle is for. A failed read draws no map and costs nothing else.
  const positions: LivePosition[] = await livePositions().catch((err) => {
    console.error('[home/people] positions failed:', errMsg(err));
    return [];
  });

  // Movement, read only for people this viewer may see. The 30-second
  // refresh re-runs this load; `loadPeopleMovement` caches each trail for
  // five minutes, so only the live cards are re-read on that clock.
  const movement: PersonMovement[] = await listMembers()
    .then((all) => loadPeopleMovement(all.filter((m) => mayOpenPerson(viewer, m.subject)), { days: DEFAULT_WINDOW_DAYS }))
    .catch((err) => {
      console.error('[home/people] movement failed:', errMsg(err));
      return [];
    });
  const asked = event.url.searchParams.get('person');
  const person = asked && movement.some((p) => p.subject === asked) ? asked : null;
  // "Your day" is offered when the filter is on the viewer's OWN subject: it
  // is read from their phone, keyed on the session (see my-day.ts).
  const own = await ownDayOf(event).catch(() => null);
  const ownSubject = own?.subject ?? null;
  const moving = { movement, person, ownSubject, movementDays: DEFAULT_WINDOW_DAYS, days, forecast, naming, agenda, notify };

  try {
    const { members } = await loadHousehold();
    const family: Family = { members: scopeHousehold(members, viewer) };
    const feedChecks = await loadFeedChecks(family.members.filter((m) => !m.notSharing).map((m) => m.subject))
      .catch((err) => {
        console.error('[home/people] feed checks failed:', errMsg(err));
        return {} as Record<string, FeedCheck>;
      });
    return { family, viewer, links: linksFor(family, viewer), loadError: null as string | null, positions, feedChecks, loadedAt: new Date(), ...moving };
  } catch (err) {
    console.error('[home/people] household load failed:', errMsg(err));
    // The error text can name tables and queries: the owner gets it, a
    // household viewer gets the fact of the failure.
    const loadError = viewer.kind === 'owner' ? errMsg(err) : 'The household could not be read just now.';
    return { family: EMPTY(), viewer, links: {} as Record<string, string>, loadError, positions, feedChecks: {} as Record<string, FeedCheck>, loadedAt: new Date(), ...moving };
  }
};

export const actions: Actions = {
  /** Which kinds of travel-desk nudge reach the owner's phone. Owner only. */
  notify: async (event) => {
    if (!(await isOwnerRequest(event))) return fail(403, { error: 'Owner access required.' });
    const form = await event.request.formData();
    const { NOTIFY_KINDS, saveNotifySettings } = await import('$lib/home/presence/watch-alerts.server');
    const settings = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, form.get(k) === 'on'])) as Record<(typeof NOTIFY_KINDS)[number], boolean>;
    try {
      await saveNotifySettings(settings);
    } catch (err) {
      console.error('[home/people] notify settings save failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.' });
    }
    return { savedNotify: true };
  },
  /**
   * Who travels for each calendar: the owner's override of "a family name in
   * the title, else the owner". `nobody` marks a calendar as not travel (a
   * work calendar of video calls). Owner only — checked here, because a form
   * action is a POST anyone can make.
   */
  calendars: async (event) => {
    if (!(await isOwnerRequest(event))) return fail(403, { error: 'Owner access required.' });
    const form = await event.request.formData();
    const subjects = new Set((await listMembers()).map((m) => m.subject));
    const map: Record<string, string[]> = {};
    for (const [key, value] of form.entries()) {
      if (!key.startsWith('cal:') || typeof value !== 'string') continue;
      const calendar = key.slice(4).slice(0, 120);
      if (value === 'auto') continue;
      map[calendar] = value === 'nobody' ? [] : value.split(',').filter((s) => subjects.has(s));
    }
    try {
      const { saveCalendarMap } = await import('$lib/home/presence/agenda.server');
      await saveCalendarMap(map);
    } catch (err) {
      console.error('[home/people] calendar map save failed:', errMsg(err));
      return fail(500, { error: 'That did not save. Try again.' });
    }
    return { savedCalendars: true };
  },
};
