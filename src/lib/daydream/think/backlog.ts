// src/lib/daydream/think/backlog.ts
//
// A `build` note becomes a backlog proposal (spec 2026-09-25, D3).
//
// The think loop can conclude that the site is missing something — a tool, a
// view, an automation. That conclusion used to have nowhere to go but the
// feed. It now also lands in the self-improvement backlog as a `feature`-kind
// idea, stamped with the `daydream` intake channel and carrying a link back to
// the note, so the backlog room is where it is groomed, prioritised or parked.
//
// A PROPOSAL, never a build: `addIdeas` only queues. Whether anything is
// dispatched is still the self-improvement propose phase's gate
// (`daydream.appetite.autobuild`).

import { addIdeas, type IdeaInput } from '$lib/selfimprove/backlog';
import { errMsg } from '../types';
import { noteHref } from './notes';

/** The thought kind a `build`-outcome note is stored under. */
export const BUILD_NOTE_KIND = 'think_build';

export interface BuildNoteRow {
  id: string;
  kind: string;
  title: string;
  narrative: string | null;
}

/** PURE. The backlog idea for one build note. */
export function buildIdeaFor(row: BuildNoteRow): IdeaInput {
  const link = noteHref(row.id);
  const body = (row.narrative ?? row.title).trim();
  // The link goes LAST and the body is trimmed to make room for it, because
  // `addIdeas` caps detail at 2,000 characters and the link is the part that
  // must survive.
  const tail = `\n\nFrom a daydream note: ${link}`;
  return {
    title: row.title,
    detail: body.slice(0, 2000 - tail.length) + tail,
    kind: 'feature',
    priority: 3,
    source: 'daydream',
  };
}

/**
 * Queue every NEW build note as a backlog idea. Soft: a backlog that cannot be
 * written must not fail the cycle that already stored and delivered the note.
 * Returns the backlog slugs created.
 */
export async function queueBuildNotes(rows: BuildNoteRow[]): Promise<string[]> {
  const ideas = rows.filter((r) => r.kind === BUILD_NOTE_KIND).map(buildIdeaFor);
  if (ideas.length === 0) return [];
  try {
    return await addIdeas(ideas);
  } catch (err) {
    console.warn(`[daydream] build note → backlog failed: ${errMsg(err)}`);
    return [];
  }
}
