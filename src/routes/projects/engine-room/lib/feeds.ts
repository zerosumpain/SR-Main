// feeds.ts — content for Reach / "Reading from the outside".
//
// Two ways the system reads external data, and one failure they share.
//
//   Hard-wired: a named connector with its own table, its own schedule and its own units.
//   Soft-wired: a catalogue of APIs the model can search and call, where nothing was written
//               in advance except the rules about credentials and where a request may go.
//
// The shared failure is that both will tell you they are fine. A stored status column is a
// record of the last time something ran, not evidence that anything works now, and treating
// the two as the same thing is the defect that let a dashboard report months-old data as
// current while the real data was arriving every few minutes.
//
// Counted from source on 7 August 2026.

export type Arrival = 'push' | 'pull';

export interface Feed {
  id: string;
  label: string;
  arrival: Arrival;
  /** How authorisation works, and therefore how it fails. */
  auth: string;
  cadence: string;
  /** What it actually delivers. */
  carries: string;
  /** The failure mode specific to this arrival style. */
  fails: string;
}

export const FEEDS: Feed[] = [
  {
    id: 'phone', label: 'The phone', arrival: 'push',
    auth: 'a shared key on the request',
    cadence: 'many times a day, whenever the phone decides',
    carries: '14 kinds of measurement — heart rate and its variability, resting rate, oxygen saturation, respiration, temperature, steps, distance, flights, energy, mass, exercise and stand time, and an aerobic-capacity estimate',
    fails: 'silently. A push feed that stops sending looks exactly like a quiet day, which is why it is treated as stale after two days rather than the three every other connector gets.',
  },
  {
    id: 'strap', label: 'The strap', arrival: 'pull',
    auth: 'a delegated-authorisation grant that can lapse',
    cadence: 'hourly, from the server',
    carries: 'recovery, heart-rate variability, resting rate, sleep stages and timings, daily strain, and per-workout zone durations',
    fails: 'loudly, eventually. A lapsed grant is discoverable by trying to use it — which is exactly what the probe does, rather than reading a column that says “active”.',
  },
  {
    id: 'activity', label: 'The activity log', arrival: 'pull',
    auth: 'a second delegated grant, separately revocable',
    cadence: 'hourly, alongside the strap',
    carries: 'routes, distances, elevation and pace for recorded activities',
    fails: 'the same way, and independently. Two grants means two things to re-consent, and no reason for one to notice the other has gone.',
  },
];

/** The analytics built on top, each with a formula, its inputs, its caveats and a citation. */
export const ANALYTICS_COUNT = 9;

export const ANALYTICS_NOTE = {
  title: 'Every derived number carries its working',
  body:
    'Nine analytics sit on the raw feeds — training load, sleep regularity, circadian drift, autonomic balance and the rest. Each one publishes its formula, which table it reads, how many days it needs before it means anything, and the paper it comes from. A composite score with no visible derivation is a horoscope with units.',
} as const;

// ---------------------------------------------------------------------------
// The unit that is not in the type
// ---------------------------------------------------------------------------

/**
 * Every measurement is stored as an integer of hundredths, so nothing is a float and nothing
 * rounds on the way in. The cost is that the column type says `integer` and the unit lives in
 * a convention — and a convention is not enforced anywhere.
 */
export const SCALE = 100;

export interface Reading {
  id: string;
  label: string;
  /** What is actually in the column. */
  stored: number;
  unit: string;
  /** What it means once unscaled. */
  real: string;
  /** What it looks like if you forget. */
  wrong: string;
}

export const READINGS: Reading[] = [
  { id: 'steps', label: 'Steps in a bucket', stored: 85_000, unit: 'steps', real: '850 steps', wrong: '85,000 steps — a hundred-fold day' },
  { id: 'weight', label: 'Body mass', stored: 7_840, unit: 'kg', real: '78.4 kg', wrong: '7,840 kg' },
  { id: 'hr', label: 'Heart rate', stored: 5_600, unit: 'bpm', real: '56 bpm', wrong: '5,600 bpm' },
  { id: 'strain', label: 'Daily strain', stored: 1_450, unit: 'a 0–21 score', real: '14.5', wrong: '1,450 on a scale that stops at 21' },
];

export const SCALE_TRAP = {
  title: 'A heuristic where a unit should be',
  body:
    'Strain is scored out of 21, and a legacy path once wrote it multiplied by a hundred like everything else. Both forms are now in the table, so the reader guesses: above 22, divide. It works, it is documented, and it is a unit conversion decided by a threshold — which is exactly the shape of thing that is correct until the scale changes underneath it.',
} as const;

// ---------------------------------------------------------------------------
// Stored status against observed status
// ---------------------------------------------------------------------------

export interface Probe {
  id: string;
  label: string;
  /** What the stored column claims. */
  stored: string;
  /** What the cheapest piece of real evidence shows. */
  observed: string;
  /** Whether the two agree. */
  agrees: boolean;
  /** The cheapest thing that counts as evidence for this connector. */
  evidence: string;
}

export const PROBES: Probe[] = [
  {
    id: 'phone', label: 'The phone', stored: 'last synced in March', observed: 'measurements arrived this morning',
    agrees: false,
    evidence: 'the newest row in the table the data actually lands in',
  },
  {
    id: 'mail', label: 'Mail', stored: 'active', observed: 'the authorisation refresh fails',
    agrees: false,
    evidence: 'an actual token refresh — the cheapest call that proves the grant still works',
  },
  {
    id: 'house', label: 'The house', stored: 'configured', observed: 'a round trip returns the sensors',
    agrees: true,
    evidence: 'a real request and a real response',
  },
  {
    id: 'models', label: 'The model gateway', stored: 'configured', observed: 'the account has credit',
    agrees: true,
    evidence: 'a balance call — which also answers the question behind the question',
  },
  {
    id: 'search', label: 'Paid search', stored: 'configured', observed: 'not checked — a probe would cost money',
    agrees: true,
    evidence: 'nothing. The probe says so rather than implying it verified something',
  },
];

export const HONESTY = {
  title: 'A status column is a memory, not a measurement',
  body:
    'Every stored status is a record of the last time something ran. It says nothing about now, and the two failure directions are not symmetrical: a column claiming health while the connector is dead is common, and the reverse — a column claiming failure while everything works — happens too, when the thing writing the column stopped running and the thing delivering the data did not.',
} as const;

export const CHEAP_BANNER = {
  title: 'The front door reads the memory anyway',
  body:
    'Probing every connector live is right for a page you opened on purpose and wrong for the front page, which would then pay seconds of third-party latency to render a banner that is usually absent. So the banner reads stored state only — four indexed queries, no network — and is a pointer rather than a verdict. The page it links to does the real probing and is the authority.',
} as const;

// ---------------------------------------------------------------------------
// The soft-wired half
// ---------------------------------------------------------------------------

export const CATALOGUE = {
  seeded: 12,
  timeoutSec: 15,
  maxResponseKb: 100,
} as const;

export const CATALOGUE_RULES = [
  { k: 'Only what is catalogued', why: 'A call can only be made against an entry in the register, and the entry fixes the base address. An arbitrary URL is not a thing the model can reach.' },
  { k: 'Credentials by handle', why: 'A record holds the NAME of a secret, never its value. The value is resolved at call time and only if the request’s host and path are on the allow-list its owner set.' },
  { k: 'Scrubbed on the way back', why: 'A resolved credential is removed from the response before anything reaches the model, so a service that echoes its own key cannot leak it into a transcript.' },
  { k: 'Every hop guarded', why: 'Redirects are re-checked, not followed on trust. The class of attack is a request that starts public and ends up pointed at the machine’s own network.' },
  { k: 'Writes are gated', why: 'Anything that changes remote state needs an explicit confirmation. Reading is delegated; acting is not.' },
  { k: 'Records are untrusted input', why: 'The register is writable by the model itself, so nothing in it is treated as trustworthy. A hand-forged entry cannot move a credential anywhere its owner did not allow.' },
];

export const FEEDS_LESSON = {
  title: 'The hard-wired and the soft-wired fail the same way',
  body:
    'A connector with its own table and a catalogue entry the model wrote last week have almost nothing in common — except that both are asked “are you working?” by something that only knows what was written down last time. The answer has to come from evidence collected now, and where that is unaffordable, the honest output is “not checked”.',
} as const;
