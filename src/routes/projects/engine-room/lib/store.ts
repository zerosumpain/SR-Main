// store.ts — content for Memory / "Somewhere to put anything".
//
// The flexible store is the answer to a question every long-lived system eventually asks:
// where does the long tail go? A typed table is right when the shape is known and stable and
// costs more than it is worth when it is not. What makes this one usable by an autonomous
// agent rather than merely convenient is the four things bolted to it: an actor on every
// call, permissions on the row, a query language with no string concatenation in it, and an
// expiry date.
//
// Counted from source on 7 August 2026.

/** The principals a call can be made on behalf of. Every call names one. */
export interface Actor {
  id: string;
  label: string;
  what: string;
}

export const ACTORS: Actor[] = [
  { id: 'owner', label: 'owner', what: 'A person at the admin interface. Always passes every check — the one principal that can never be locked out of their own data.' },
  { id: 'jkai', label: 'the assistant', what: 'Chat, and everything driving it. On the default list, so anything the assistant creates it can read back.' },
  { id: 'system', label: 'system', what: 'Engines, the nightly loop and the expiry sweep. Named separately so a deletion at three in the morning is attributable to a process rather than to a person.' },
  { id: 'workflow:42', label: 'one workflow', what: 'A specific automation run. Concrete, so a record can be readable by exactly one workflow and nothing else.' },
  { id: 'stranger', label: 'anything else', what: 'A principal on nobody’s list. The default answer is no.' },
];

/** The wildcards a permission list may contain. */
export const WILDCARDS = [
  { k: '*', why: 'Any authenticated principal. The widest thing a list can say, and it still says it explicitly.' },
  { k: 'workflow:*', why: 'Any workflow run, without naming one. Useful for a collection several automations share; useless for isolating them from each other, which is the point of the concrete form.' },
];

/**
 * The resolution chain. Root-first is wrong here — the NEAREST setting wins, and any action
 * missing from it falls back to the built-in default for that action alone rather than
 * dragging the whole map back down a level.
 */
export const PRECEDENCE = [
  { id: 'record', label: 'the record’s own permissions', what: 'Set on the row. Wins outright when present.' },
  { id: 'collection', label: 'the collection’s default', what: 'Applies to every row that has not overridden it.' },
  { id: 'builtin', label: 'the built-in default', what: 'Whoever created it, plus the owner, plus the assistant. What a record gets when nobody has said anything.' },
];

export const PER_ACTION = {
  title: 'A missing action falls back on its own',
  body:
    'A permission map with only `read` set does not mean “nobody may write”. Each of read, write and delete resolves independently, so an absent one takes the built-in default for that action rather than inheriting the silence of the others. Writing a partial map is therefore a narrowing of one capability, not an accidental lock-out of the rest.',
} as const;

/** Worked records for the bench. Each one is a different shape of permission. */
export const RECORDS = [
  {
    id: 'open', label: 'A shared lookup table',
    perms: { read: ['*'], write: ['owner'], delete: ['owner'] },
    story: 'Readable by anything that has signed in, writable only by a person. The wildcard is on read alone.',
  },
  {
    id: 'scratch', label: 'One workflow’s scratch space',
    perms: { read: ['workflow:42', 'owner'], write: ['workflow:42'], delete: ['workflow:42', 'owner'] },
    story: 'Named concretely, so a second workflow — even a well-behaved one — simply cannot see it.',
  },
  {
    id: 'shared', label: 'A queue several automations share',
    perms: { read: ['workflow:*'], write: ['workflow:*'], delete: ['owner'] },
    story: 'Any workflow may take from it; only a person may remove the queue itself.',
  },
  {
    id: 'default', label: 'Nothing set at all',
    perms: null,
    story: 'Falls through the collection to the built-in default: its creator, the owner and the assistant.',
  },
];

// ---------------------------------------------------------------------------
// The query language
// ---------------------------------------------------------------------------

export const QUERY = {
  operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists', 'in'],
  defaultLimit: 100,
  maxLimit: 500,
  sortFields: ['createdAt', 'updatedAt', 'key'],
  aggregates: ['count', 'sum', 'avg', 'min', 'max'],
} as const;

export const QUERY_SAFETY = [
  { k: 'Values are parameters', why: 'A filter value is bound, never concatenated. There is no code path in which a value becomes part of the statement text.' },
  { k: 'Paths are whitelisted', why: 'A field path must match letters, digits, underscores and dots, and is bound as an array parameter — so the document operators can be used with no injection surface at all.' },
  { k: 'Sorts come from a fixed map', why: 'A sort names one of three known columns or a validated path. A column name arriving from a caller is never trusted as SQL.' },
  { k: 'The page size is capped', why: 'A hundred by default, five hundred at most. An agent asking for everything gets a page and a cursor.' },
  { k: 'One language, three surfaces', why: 'A workflow node, an agent toolset and the admin interface express the same filter the same way, so none of them has to learn SQL and none of them can invent its own dialect.' },
];

// ---------------------------------------------------------------------------
// Expiry and the ledger
// ---------------------------------------------------------------------------

export const EXPIRY = [
  { id: 'absolute', label: 'Per record', what: 'A date on the row. Once it is in the past the row is gone at the next sweep.', use: 'A one-off — a token, a draft, a cached answer with a known shelf life.' },
  { id: 'relative', label: 'Per collection', what: 'A lifetime measured from when the row last changed, set once on the collection.', use: 'A whole class of scratch data, so nothing has to remember to set a date.' },
  { id: 'never', label: 'Neither', what: 'The row stays until something deletes it.', use: 'Anything that is a record rather than a working note.' },
];

export const REAPER = {
  title: 'Scratch data does not become permanent by neglect',
  body:
    'The sweep runs at boot and then hourly, and every deletion it makes is written to the ledger as an expiry by the system actor — so a row that vanishes has an entry saying why. Without a lifetime, the default fate of temporary data is to be permanent, and the store fills with things nobody chose to keep.',
} as const;

export const LEDGER = {
  actions: ['insert', 'update', 'delete', 'expire', 'permissions', 'collection_create'],
  title: 'Every write is attributable',
  body:
    'The ledger records the actor, the action, and the row before and after. In a system where a machine writes at three in the morning, “who did this” has to have an answer that is not a guess — and a permission change is logged as its own kind of event, because widening access is a different act from editing a value.',
} as const;

export const LIMITS = [
  { k: 'A lifetime', why: 'Set on the collection, so scratch data ages out without anybody remembering.' },
  { k: 'A record ceiling', why: 'A collection can be told how many rows it may hold, which turns a runaway writer into a refusal instead of a disk.' },
  { k: 'A payload ceiling', why: 'And how large one row may be, for the same reason.' },
];

export const STORE_LESSON = {
  title: 'A schema-free store is only as good as its access layer',
  body:
    'Dropping the schema is the easy half and it is not the interesting one. What makes this usable by something that writes unattended is that every call names who it is for, the answer comes from one place, and the whole of it is written down afterwards.',
} as const;
