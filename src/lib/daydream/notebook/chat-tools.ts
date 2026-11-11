// src/lib/daydream/notebook/chat-tools.ts
//
// jkai's notebook tools (workflow knit 2026-11-11, slice 3): the notes at
// /jkai/notes.
//
//   notebook_search   John's notes matching some words, a folder or a tag
//   notebook_add      write a new note                         (light: a mutate)
//
// Both go through `./store`. Searching is a filter over `listNotes`, which
// reads the owner's notes only; no second query. Adding only ever CREATES: it
// never takes an id, so a chat turn cannot overwrite or archive a note John
// wrote. It sits on the same tier as save_memory, the other tool that writes
// something down for him.
//
// Owner-only, not member-safe. Registered from here (src/hooks.server.ts
// imports this module at boot).

import { register } from '$lib/tools/registry-internal';
import { refuseUnlessOwner } from '$lib/tools/tools/owner-only';
import { listNotes, saveNote } from './store';

const PAGE = '/jkai/notes';
/** How much of a note's body one search result carries. */
export const NOTE_SNIPPET = 400;
/** The longest body a chat turn may write in one note. */
export const NOTE_BODY_MAX = 8000;

const text = (raw: unknown, max: number) => (typeof raw === 'string' ? raw.trim().slice(0, max) : '');
const int = (raw: unknown, min: number, max: number, fallback: number) =>
  typeof raw === 'number' && Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.trunc(raw))) : fallback;

/** The part of `body` around the first match of `q`, or its opening. PURE. */
export function noteSnippet(body: string, q: string, cap = NOTE_SNIPPET): string {
  const b = body ?? '';
  if (b.length <= cap) return b;
  const at = q ? b.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(cap / 4));
  return `${start > 0 ? '…' : ''}${b.slice(start, start + cap)}${start + cap < b.length ? '…' : ''}`;
}

register({
  name: 'notebook_search',
  description:
    "Search John's notebook (/jkai/notes): notes whose title, body, folder or tags contain the words, optionally within one folder or tag. Returns each note's title, folder, tags and the part of the body around the match. With no words it lists the newest notes. Read-only.",
  parameters: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Words to look for. Every word must appear.' },
      folder: { type: 'string', description: 'Optional: only this folder.' },
      tag: { type: 'string', description: 'Optional: only notes with this tag.' },
      limit: { type: 'number', minimum: 1, maximum: 25, description: 'Most notes. Default 10.' },
    },
    required: [],
  },
  category: 'Notes',
  toolset: 'notes',
  effect: 'read',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('notebook_search', ctx);
    if (refused) return refused;
    const q = text(args.q, 200);
    const folder = text(args.folder, 80).toLowerCase();
    const tag = text(args.tag, 40).toLowerCase();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    try {
      const notes = (await listNotes()).filter((n) => {
        if (folder && n.folder.toLowerCase() !== folder) return false;
        if (tag && !n.tags.some((t) => t.toLowerCase() === tag)) return false;
        const hay = `${n.title}\n${n.body}\n${n.folder}\n${n.tags.join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const shown = notes.slice(0, int(args.limit, 1, 25, 10)).map((n) => ({
        id: n.id,
        title: n.title || n.body.split('\n')[0]?.slice(0, 80) || '(untitled)',
        folder: n.folder || null,
        tags: n.tags,
        pinned: n.pinned,
        updatedAt: n.updatedAt,
        snippet: noteSnippet(n.body, words[0] ?? ''),
      }));
      return { success: true, data: { matched: notes.length, notes: shown, url: PAGE, message: shown.length ? undefined : 'No note matched.' } };
    } catch (err) {
      return { success: false, error: `notebook_search could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});

register({
  name: 'notebook_add',
  description:
    `Write a new note in John's notebook (/jkai/notes) when he asks for something to be noted down: a title, the body (up to ${NOTE_BODY_MAX} characters), and optionally a folder and tags. It only ever creates a note; changing or archiving one is done on the page. For a fact about John that jkai should remember, use save_memory instead.`,
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short title.' },
      body: { type: 'string', description: 'The note, in plain text or markdown.' },
      folder: { type: 'string', description: 'Optional folder name.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
    },
    required: ['body'],
  },
  category: 'Notes',
  toolset: 'notes',
  effect: 'mutate',
  surfaces: ['chat', 'app'],
  handler: async (args, ctx) => {
    const refused = refuseUnlessOwner('notebook_add', ctx);
    if (refused) return refused;
    const body = typeof args.body === 'string' ? args.body.trim() : '';
    if (!body) return { success: false, error: 'body is required: the text of the note.' };
    if (body.length > NOTE_BODY_MAX) return { success: false, error: `body is at most ${NOTE_BODY_MAX} characters; this is ${body.length}.` };
    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string').slice(0, 12) : undefined;
    try {
      const note = await saveNote({ title: text(args.title, 200), body, folder: text(args.folder, 80) || undefined, tags, principalId: 'owner' });
      return { success: true, data: { id: note.id, title: note.title, folder: note.folder || null, url: PAGE } };
    } catch (err) {
      return { success: false, error: `notebook_add failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
    }
  },
});
