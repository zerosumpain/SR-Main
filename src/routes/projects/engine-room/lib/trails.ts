// trails.ts — the outdoor field kit, counted from the source on 17 August 2026.
//
// Everything on reach/trails renders from this file. The tile figures, zoom range and
// padding are the ones the live download planner uses; the difficulty bands are the ones
// the live grader uses. No figure on the page may appear that is not in here.

/** The offline map budget, as the download planner actually computes it. */
export const TILE = {
  /** Zoom levels fetched for a route: enough to navigate, not the whole ladder. */
  minZoom: 12,
  maxZoom: 16,
  /** Whole tiles of padding around the route's box, at every zoom. */
  pad: 2,
  /** Planning figure per tile, in bytes. */
  bytesPerTile: 25_000,
  /** What a sample of real tiles actually averaged, in KB — the planning figure is rounded down from this. */
  measuredKb: 27,
  /** The figure an earlier estimate assumed, in KB — wrong by nearly half. */
  assumedKb: 15,
} as const;

export const PAD_STORY = {
  title: 'Two tiles of padding, not one',
  body:
    'A phone screen is wider than a route’s bounding box, so at navigating zoom the edges of ' +
    'the view fall outside it. With one tile of padding, a verified offline run still fetched ' +
    'three edge tiles from the network — which, on a hill with no signal, means three grey squares.',
} as const;

/** Naismith difficulty — the live grader's own bands (upper bounds of easy/moderate/hard, in equivalent km). */
export const BANDS: Record<string, [number, number, number]> = {
  walk: [6, 12, 20],
  hike: [10, 18, 28],
  run: [8, 14, 22],
  trail_run: [9, 16, 26],
  ride: [35, 70, 110],
  mtb: [20, 40, 65],
};

export const SPORT_LABEL: Record<string, string> = {
  walk: 'Walk',
  hike: 'Hike',
  run: 'Run',
  trail_run: 'Trail run',
  ride: 'Ride',
  mtb: 'Mountain bike',
};

export const NAISMITH = {
  title: 'One number for how hard a route is',
  body:
    'Every 100 metres of climb costs about the same effort as a kilometre on the flat, so ' +
    'distance plus climb collapses into one figure — equivalent kilometres — that can be banded ' +
    'per sport. It is deliberately a second axis: the quality score says whether a route is a ' +
    'good loop; this says whether you will feel it tomorrow.',
} as const;

/** The planner, in three lines: who does what and why the split exists. */
export const PLANNER = [
  {
    k: 'A router draws the candidates',
    v: 'real paths only',
    why:
      'Route geometry comes from a routing service over real mapped paths. The alternative — letting ' +
      'a language model “snap” a route to the map — is how a ten-kilometre loop quietly gains a dead-end lane.',
  },
  {
    k: 'Our scorer ranks them',
    v: 'pure functions',
    why:
      'Loop quality — how much retracing, how many dead-end spurs, whether the surface suits the sport — ' +
      'is scored by plain arithmetic that runs identically every time and is fully tested without any network at all.',
  },
  {
    k: 'A sentence fills the form',
    v: 'nothing invented',
    why:
      'You can commission a route in plain English. The model may only fill the form’s actual fields, ' +
      'values are clamped server-side, and anything you did not say is left unset rather than guessed.',
  },
] as const;

/** The rules that keep an unattended planner polite and honest. */
export const GUARDS = [
  {
    k: 'Tired days propose a walk',
    v: 'readiness < 40',
    why: 'When the morning readiness score is poor, the proposal swaps a run for a walk — it vetoes impact, not just distance.',
  },
  {
    k: 'Suggestions need three outings',
    v: '≥ 3',
    why: 'A distance suggestion from one outing is whichever outing happened. Below three, it declines to guess — one short test recording would poison every later suggestion.',
  },
  {
    k: 'Loops are capped',
    v: '100 km',
    why: 'The routing service will not draw a circular route past 100 km, and the free tier allows 2,500 requests a day — so candidates are requested one at a time, never as a burst.',
  },
  {
    k: 'Tiles are fetched politely',
    v: 'one by one',
    why: 'The map tiles come from a volunteer-run service whose policy asks for no bulk downloading. Losing its goodwill would take the map away everywhere, not just offline.',
  },
  {
    k: 'Real units, stored as-is',
    v: 'metres are metres',
    why: 'Distances and climbs are stored in plain SI units. Another table here stores hundredths-of-a-unit as integers, and that convention has already produced values wrong by a factor of one hundred.',
  },
] as const;

export const WHY_PRIVATE = {
  title: 'Why there are no screenshots of this one',
  body:
    'The whole area is owner-only, and not out of shyness: a GPS trace of a morning run starts ' +
    'at the front door. Publishing the map, even once, publishes where the front door is. The ' +
    'mechanisms are describable; the traces are not.',
} as const;

export const PWA = {
  title: 'An app, installed from the website',
  body:
    'This site installs on a phone as an app and keeps working without a connection — the map ' +
    'tiles live in the browser’s own storage, and the map layer reads that cache before it asks ' +
    'the network. The honest test of offline is not “did the download succeed”: it is blocking ' +
    'the tile server and watching the map still draw.',
} as const;
