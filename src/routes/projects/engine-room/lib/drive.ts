// drive.ts — content for Reach / "The filing cabinet".
//
// The argument the page makes: a document store is easy and a document store you can ask
// questions of is not, because "searchable" means something different for a spreadsheet, a
// photograph and a voice memo. Six paths, one index, and the interesting engineering is in
// what each modality has to be turned INTO before the same machinery works on it.
//
// Every figure counted from source on 7 August 2026.

export type Modality = 'text' | 'image' | 'audio' | 'refused';

export interface FileKind {
  id: string;
  label: string;
  /** What the reader would recognise. */
  example: string;
  modality: Modality;
  /** The steps this kind actually goes through, in order. */
  path: string[];
  /** The one thing worth knowing about this path. */
  note: string;
}

/**
 * The dispatch, in the order the real one tries it: images first, then audio, then the
 * text-extractable kinds, then nothing. "Nothing" is a real branch and the page shows it —
 * a store that silently drops what it cannot read is worse than one that says so.
 */
export const FILE_KINDS: FileKind[] = [
  {
    id: 'pdf', label: 'A report', example: 'a 40-page PDF', modality: 'text',
    path: ['hash the bytes', 'extract the text', 'chunk it', 'embed each chunk', 'index'],
    note: 'The straightforward path, and the one the other five are bent into the shape of.',
  },
  {
    id: 'sheet', label: 'A spreadsheet', example: 'a workbook of returns', modality: 'text',
    path: ['hash the bytes', 'extract the text', 'chunk it', 'embed each chunk', 'index'],
    note: 'Flattened to text, which loses the grid. Good enough to find the sheet; not a substitute for opening it.',
  },
  {
    id: 'photo', label: 'A photograph', example: 'a picture of a whiteboard', modality: 'image',
    path: ['hash the bytes', 'caption it with a vision model', 'read any text in it', 'chunk', 'embed', 'index'],
    note: 'A photograph has no text, so one is written for it: a literal description plus a verbatim reading of anything visible. That description is what search actually matches on.',
  },
  {
    id: 'audio', label: 'A voice memo', example: 'a recorded thought', modality: 'audio',
    path: ['hash the bytes', 'transcribe it', 'chunk', 'embed', 'index'],
    note: 'Best-effort. A failed transcription leaves the file findable by its name rather than failing the upload — but it is silently thinner than it looks.',
  },
  {
    id: 'video', label: 'A video', example: 'a screen recording', modality: 'refused',
    path: ['hash the bytes', 'skipped'],
    note: 'Deferred rather than attempted. Nothing pretends to have read it.',
  },
  {
    id: 'huge', label: 'Anything very large', example: 'a 400 MB archive', modality: 'refused',
    path: ['size checked', 'refused before the bytes are read'],
    note: 'The cap exists because the always-on machine at home is memory-bound and loading one file whole would take the whole service down with it.',
  },
];

export const INDEX = {
  /** Bytes ever read into memory to index one file. */
  maxIndexableMb: 25,
  /** Global index dimensions — the cheaper embedding, always on. */
  globalDims: 1536,
  /** Per-collection index dimensions — the better embedding, built on request. */
  collectionDims: 3072,
  /** Passages returned by default. */
  topK: 8,
  /** Below this similarity a passage is dropped rather than padding the list out. */
  minSimilarity: 0.2,
  /** Characters of a passage carried into a prompt. */
  maxPassageChars: 1200,
  /** One backfill request will not walk more files than this. */
  backfillLimit: 1000,
} as const;

export const HASH_GATE = {
  title: 'The unit of work is the bytes, not the row',
  body:
    'Indexing is keyed on a hash of the current bytes, so it is safe to fire from every write site and free to repeat. Renaming a file or editing its description bumps the row and changes nothing that matters, so no model is called. Two concurrent writes each fire a reindex; the last step takes a per-file lock and re-reads the bytes under it, so an out-of-order commit cannot leave stale vectors behind.',
} as const;

// ---------------------------------------------------------------------------
// Folders that do not exist
// ---------------------------------------------------------------------------

export const VIRTUAL_FOLDERS = {
  title: 'There are no folders',
  body:
    'A folder is a slash-separated prefix of a file name and nothing else — there is no folder table and no folder row. Every setting therefore hangs off a path string, and has to be resolved by walking the ancestors of that string. Which is fine, until two settings need two different inheritance rules.',
} as const;

export interface PolicyRule {
  id: string;
  setting: string;
  rule: string;
  why: string;
}

export const POLICY_RULES: PolicyRule[] = [
  {
    id: 'mode', setting: 'Include or exclude', rule: 'the nearest ancestor with an explicit answer wins',
    why: 'Excluding a whole tree and then re-including one folder inside it has to work, and a union cannot express that.',
  },
  {
    id: 'categories', setting: 'Labels', rule: 'the union of every ancestor’s labels',
    why: 'A label put on a parent is true of everything inside it. Requiring it to be repeated on each child would make labelling pointless.',
  },
];

/**
 * The worked tree for the policy instrument. Each node may carry an explicit mode and some
 * labels; the leaf's effective policy is computed by the page from these two rules.
 */
export const POLICY_TREE = [
  { path: '', label: 'root', mode: 'include' as const, cats: [] as string[] },
  { path: 'clients', label: 'clients', mode: 'exclude' as const, cats: ['commercial'] },
  { path: 'clients/northgate', label: 'northgate', mode: 'include' as const, cats: ['live'] },
  { path: 'clients/northgate/2026', label: '2026', mode: 'inherit' as const, cats: ['current'] },
];

// ---------------------------------------------------------------------------
// The rest of what the store is
// ---------------------------------------------------------------------------

export const DRIVE_FACTS = [
  { k: 'A network drive', v: 'mounted, not uploaded',
    why: 'The store speaks the same protocol a desktop file manager does, so it appears as a drive in the operating system. Credentials are per-mount, stored only as a hash, and revocable one at a time.' },
  { k: 'Permissions live on the row', v: 'read · write · append · delete',
    why: 'Who may do what is a property of the file, not of whichever endpoint happens to reach it. Retrieval is filtered by that before anything is assembled into a prompt.' },
  { k: 'Two indexes, two budgets', v: '1,536 always-on · 3,072 on request',
    why: 'Everything is in the cheap global index so file mentions work everywhere. A collection you have chosen to talk to gets the better, dearer embedding.' },
  { k: 'Files feed the graph', v: 'per folder, opt-in or opt-out',
    why: 'Indexing a document and extracting people and organisations out of it are different consents. One folder can be searchable but invisible to the graph.' },
  { k: 'Passages carry provenance', v: 'always',
    why: 'A retrieved passage arrives with where it came from, so an answer built on it can be traced rather than asserted.' },
  { k: 'A viewer, not a download', v: 'in the browser',
    why: 'Documents, sheets, images and audio are read in place. A store you have to download from to use is a folder with extra steps.' },
];

export const DRIVE_LESSON = {
  title: 'Searchable is a per-modality claim',
  body:
    'One index, one query, one set of permissions — but a photograph only reaches it because a model wrote a description of it first, and a voice memo only because another one transcribed it. The uniform surface is real. The uniform capability behind it is not, and the page says which files are thinner than they look.',
} as const;
