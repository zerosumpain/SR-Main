// ground.ts — content for Part V, "Ground": where the system actually runs, and where the
// bytes actually live.
//
// Machines are described by role, never by address. No hostnames, no regions, no account
// names, no ports — the same rule the rest of the study follows, for the same reason: an
// inventory of somebody's infrastructure is not an architectural insight, it is a target list.
//
// Counted from source on 7 August 2026.

export type Place = 'origin' | 'house' | 'runner' | 'store';

export interface Machine {
  id: Place;
  label: string;
  /** One line: what it is for. */
  strap: string;
  /** Why this thing exists as a separate place at all. */
  reason: string;
  /** What it can and cannot reach. */
  exposure: string;
  tone: string;
}

export const MACHINES: Machine[] = [
  {
    id: 'origin', label: 'The origin', strap: 'A small rented server. Everything public comes from here.',
    reason: 'Something has to be up at four in the morning when nobody is home, on a connection nobody unplugs to hoover.',
    exposure: 'No inbound port is open on it at all. It dials out to the edge and the edge sends traffic back down that connection, so there is nothing on the public internet to knock on.',
    tone: 'var(--accent-ink)',
  },
  {
    id: 'house', label: 'The house', strap: 'A machine at home, on an ordinary domestic connection.',
    reason: 'Three things genuinely cannot be done from a data centre, and they are the only reason it exists.',
    exposure: 'Not reachable from the internet either. The two machines see each other over a private encrypted mesh and nothing else does.',
    tone: 'var(--success)',
  },
  {
    id: 'runner', label: 'The disposable machine', strap: 'A throwaway that exists for the length of one check.',
    reason: 'It runs code nobody has reviewed yet, which is exactly the code that should not be running next to production.',
    exposure: 'Holds no secrets and no production key. It can fail the build and it cannot reach the thing the build is for.',
    tone: '#b0892a',
  },
  {
    id: 'store', label: 'Object storage', strap: 'Not a machine — a bucket of bytes in one region.',
    reason: 'A server’s disk is the wrong place for anything you would mind losing when the server is rebuilt.',
    exposure: 'Written by the origin, and by nothing that faces the public directly.',
    tone: 'var(--accent)',
  },
];

/** Why anything is at home at all. Three reasons, and each is a property of the place. */
export const HOUSE_REASONS = [
  {
    k: 'A residential address is the product',
    why: 'The browser that reads pages which will not be read any other way has to look like a person at home, because that is what it is pretending to be. Running it from a data centre would be both less effective and a good way to get the address blocked.',
  },
  {
    k: 'A phone pairing is bound to a device',
    why: 'The bridge that lets the assistant be reached from a phone with nothing installed is paired to a handset. A pairing is not a credential you can copy to a server.',
  },
  {
    k: 'A warm second copy',
    why: 'The database is pulled down here every night. It is not a backup — the backup is off-site and encrypted — it is a copy you can open and query without touching production.',
  },
];

export const HOUSE_COST = {
  title: 'And what it costs',
  body:
    'Domestic broadband, a mains supply nobody is on call for, and a memory ceiling that shapes what may run here — which is why the document indexer refuses anything over 25 MB. Those three are the price of the three capabilities above, and nothing else that could run here does.',
} as const;

// ---------------------------------------------------------------------------
// The hostname decides
// ---------------------------------------------------------------------------

export interface Subsystem {
  id: string;
  label: string;
  /** What it does, in one line. */
  what: string;
  /** Where it is allowed to wake up. */
  runs: Place[];
  /** Why it is gated that way. */
  why: string;
  /** How the gate is written. */
  gate: 'hostname' | 'flag';
}

/**
 * The real gates. Two directions and two mechanisms, which is the whole point of the page:
 * the same code is deployed to both machines and what it is ALLOWED to do is decided at
 * startup by which machine it woke up on.
 */
export const SUBSYSTEMS: Subsystem[] = [
  {
    id: 'serve', label: 'Serving the site', what: 'Rendering pages and answering requests.',
    runs: ['origin', 'house'], gate: 'hostname',
    why: 'Both run it. Only one of them is on the public internet.',
  },
  {
    id: 'selfimprove', label: 'The night shift', what: 'Reads its own failures and writes improvements.',
    runs: ['origin'], gate: 'hostname',
    why: 'Two copies of a nightly job that writes to a shared database is not redundancy, it is a race. Refuses to schedule at home unless deliberately switched on.',
  },
  {
    id: 'doctor', label: 'The workflow doctor', what: 'Checks every automation overnight and disables the broken ones.',
    runs: ['origin'], gate: 'hostname',
    why: 'Same rule. A second doctor would fight the first over the same patients.',
  },
  {
    id: 'auction', label: 'The model auction', what: 'Re-scores the model catalogue against price and capability.',
    runs: ['origin'], gate: 'hostname',
    why: 'Same rule, and the result is a shared setting — the last writer would win for reasons nobody could reconstruct.',
  },
  {
    id: 'briefing', label: 'The morning briefing', what: 'Assembles and sends the daily summary.',
    runs: ['origin'], gate: 'hostname',
    why: 'Same rule, with a visible symptom: two copies means the briefing arrives twice.',
  },
  {
    id: 'monitor', label: 'The connector check', what: 'Probes every integration daily and raises what is broken.',
    runs: ['origin'], gate: 'hostname',
    why: 'Same rule. Also: probing a delegated grant from two places doubles the chance of tripping a rate limit on the thing being checked.',
  },
  {
    id: 'scrape', label: 'The stealth browser', what: 'Reads pages that will not be read any other way.',
    runs: ['house'], gate: 'hostname',
    why: 'The exact inverse, and the reason the gate exists in both directions: this one REFUSES to run anywhere but home, and says so rather than quietly working badly.',
  },
  {
    id: 'agent', label: 'The agent runtime', what: 'Owns the conversation, its tools and its session state.',
    runs: ['house'], gate: 'hostname',
    why: 'It lives with the phone bridge. The origin drives it across the private mesh instead of holding a second copy, so there is one conversation history rather than two halves of one.',
  },
  {
    id: 'registry', label: 'The credential register', what: 'The credentials the assistant uses and cannot read.',
    runs: ['origin'], gate: 'flag',
    why: 'The one that has to be a flag rather than a hostname test — see below. There is exactly one register and it is production’s.',
  },
  {
    id: 'gate', label: 'The gate', what: 'Lint, types, tests, build, and the two bespoke checks.',
    runs: ['runner'], gate: 'hostname',
    why: 'It runs unreviewed code, so it runs somewhere that will be destroyed afterwards and holds nothing worth stealing.',
  },
];

export const ONE_REGISTER = {
  title: 'Exactly one credential register, by design',
  body:
    'Only the origin holds one; the machine at home is configured to hold none at all. Two would not be redundancy: each host encrypts under its own key, so neither could restore the other, and some providers rotate a refresh token on every exchange — meaning a second reader is a second writer, and reading a credential in one place would retire it in the other. Singularity is the property that makes the register safe to automate against.',
} as const;

export const FLAG_NOT_HOSTNAME = {
  title: 'Why that one gate is a flag and the others are not',
  body:
    'A hostname test ships to production and then misfires on any machine that happens to carry that name — including a build runner somebody names after the box it replaced. For a gate that decides whether a credential store exists, the failure is silent and expensive, so it is opted into by configuration instead. For a gate that decides whether a scraper runs, a loud refusal on the wrong machine is the correct outcome and a hostname is the honest test.',
} as const;

export const ESTATE_LESSON = {
  title: 'One codebase, and the machine decides',
  body:
    'There is no production branch and no separate deployment for the machine at home. The same code is on both, and every difference between them is a startup decision made by reading which machine this is. That is what makes “it works on my machine” a testable claim rather than a joke: the difference is enumerable, and it is the list above.',
} as const;

// ---------------------------------------------------------------------------
// Where the bytes live
// ---------------------------------------------------------------------------

export interface Store {
  id: string;
  label: string;
  holds: string;
  why: string;
  /** What it would cost to lose it. */
  loss: string;
}

export const STORES: Store[] = [
  {
    id: 'db', label: 'The database', holds: 'Every row, and the always-on vector index beside them.',
    why: 'One database for everything. No second store to keep in sync, no separate service to be down on its own, and a retrieval query is a join rather than a network call.',
    loss: 'Everything the system knows. This is the one that is backed up twice.',
  },
  {
    id: 'blob', label: 'Object storage', holds: 'File bytes, media, images — and the large embedding indexes.',
    why: 'The server’s disk is rebuilt when the server is. Bytes that would be missed do not live on something disposable.',
    loss: 'The documents themselves. The rows describing them would survive and point at nothing.',
  },
  {
    id: 'disk', label: 'The origin’s disk', holds: 'The built application, and nothing that matters.',
    why: 'Deliberately worthless. Everything on it can be rebuilt from the code host in one pipeline run.',
    loss: 'Twenty minutes.',
  },
  {
    id: 'offsite', label: 'Off-site backup', holds: 'An encrypted, deduplicated nightly snapshot.',
    why: 'A backup on the same machine is a copy, not a backup. This one is somewhere else, and it is encrypted before it leaves.',
    loss: 'The ability to recover from any of the above.',
  },
];

export const BIG_INDEX = {
  title: 'The big index is a file, not a column',
  body:
    'The per-collection embedding index is written to object storage as newline-delimited JSON rather than into the database’s vector column. Two reasons, both practical: a schema change then never depends on the vector extension being present for that table, and the dimension stops being part of the schema — so a better, wider embedding model can be adopted without a migration. The small always-on index stays in the database, where a join is worth more than the flexibility.',
} as const;

export interface Failure {
  id: string;
  label: string;
  /** What actually recovers it, in order of preference. */
  recovers: string[];
  /** How much is lost even when recovery works. */
  cost: string;
  /** True when nothing recovers it. */
  fatal?: boolean;
}

export const FAILURES: Failure[] = [
  {
    id: 'deploy', label: 'A bad deploy goes live',
    recovers: ['the previous commit, through the same pipeline'],
    cost: 'Minutes. A marker records exactly which commit is serving, so “is the bad one still live?” has an answer rather than a guess.',
  },
  {
    id: 'table', label: 'A table is dropped at three in the morning',
    recovers: ['the nightly encrypted snapshot', 'the copy pulled to the house last night'],
    cost: 'Up to a day of writes. Two independent copies of the same age, which is redundancy against the backup itself failing, not against time.',
  },
  {
    id: 'origin', label: 'The origin is gone entirely',
    recovers: ['the code host for everything that is code', 'the off-site snapshot for everything that is data', 'object storage for the bytes'],
    cost: 'An afternoon. Nothing on that machine was unique, which was the design goal.',
  },
  {
    id: 'house', label: 'The house goes dark',
    recovers: ['nothing needs to — the public site never depended on it'],
    cost: 'The scraper and the phone bridge stop. Everything anyone else can see carries on.',
  },
  {
    id: 'key', label: 'An encryption key is lost',
    recovers: ['a separate encrypted escrow, held apart from the backups'],
    cost: 'Without the escrow: nothing. Stored credentials and connector grants are encrypted at rest, so the snapshot restores rows that can never be read again. A backup of ciphertext is not a backup.',
    fatal: true,
  },
];

export const ESCROW_NOTE = {
  title: 'The thing a database backup cannot save',
  body:
    'Encrypting credentials at rest is obviously right and it creates a second thing to lose. The nightly snapshot faithfully preserves rows that are unreadable without a key that is not in it — so the keys are escrowed separately, encrypted under a different secret, and the two are never carried in the same place.',
} as const;
