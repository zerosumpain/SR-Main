// The desk, once a day, without being visited.
//
// Everything else about /news is PULL: it only exists while a page is open. The
// brief is the one push, and it is deliberately the quietest kind — it writes a
// notebook note the owner reads when he chooses to, and notifies nobody. Same
// call as the daydream digest: thinking volume can rise without interruption
// volume rising with it.
//
// No LLM. The selection is the correlation rule that already runs on the desk,
// and the prose is assembled from counts and entity names we own. A model could
// only add phrasing, and phrasing is where a summary starts inventing.

import { saveNote } from '$lib/daydream/notebook/store';
import { getNewsFeed } from './sources';
import { correlateStories } from './correlate';
import { loadAnchors } from './correlate.server';
import { keptKeysFor } from './stats';
import type { NewsStory } from './types';

/** Most stories to name. A brief that lists twenty is a feed, not a brief. */
const MAX_STORIES = 6;

export interface NewsBriefResult {
  written: boolean;
  noteId?: string;
  /** Stories that matched the graph, whether or not a note was written. */
  matched: number;
  scanned: number;
  anchors: number;
  reason?: string;
}

function line(story: NewsStory, names: string[], notes: number): string {
  const where = story.alsoOn.length
    ? `${story.sourceLabel} + ${story.alsoOn.map((a) => a.sourceLabel).join(' + ')}`
    : story.sourceLabel;
  const held = notes > 0 ? `; you hold ${notes} note${notes === 1 ? '' : 's'} on it` : '';
  return [
    `- [${story.title}](${story.url})`,
    `  ${where} · tracks ${names.join(', ')}${held}`,
  ].join('\n');
}

/**
 * Build today's brief.
 *
 * Returns `written: false` with a reason rather than throwing, so the heartbeat
 * can report a quiet day as clearly as a busy one — and so a morning with
 * nothing relevant on the wire does not look like a broken activity.
 */
export async function buildNewsBrief(): Promise<NewsBriefResult> {
  const feed = await getNewsFeed('top', { force: true });
  if (feed.stories.length === 0) {
    return { written: false, matched: 0, scanned: 0, anchors: 0, reason: 'no stories on the wire' };
  }

  const { anchors } = await loadAnchors();
  if (anchors.length === 0) {
    return {
      written: false,
      matched: 0,
      scanned: feed.stories.length,
      anchors: 0,
      reason: 'the knowledge graph has nothing to rank against',
    };
  }

  const correlated = correlateStories(feed.stories, anchors, { limit: MAX_STORIES });
  if (correlated.length === 0) {
    return {
      written: false,
      matched: 0,
      scanned: feed.stories.length,
      anchors: anchors.length,
      reason: 'nothing on the wire matched the graph',
    };
  }

  // Already-kept stories are named but marked, rather than dropped: seeing the
  // same story twice is how you notice it is still running.
  const kept = await keptKeysFor(correlated.map((entry) => entry.story.key));

  const body = [
    `${correlated.length} of ${feed.stories.length} stories on the desk touch something you track.`,
    '',
    ...correlated.map((entry) =>
      line(
        entry.story,
        entry.matches.map((match) => match.anchor.name),
        entry.matches[0].anchor.evidence?.notes ?? 0,
      ) + (kept.has(entry.story.key) ? '\n  Already kept in the graph.' : ''),
    ),
    '',
    `[Open the desk](/news?view=for-you)`,
  ].join('\n');

  const note = await saveNote({
    title: `News brief — ${new Date().toISOString().slice(0, 10)}`,
    folder: 'News',
    tags: ['news', 'brief'],
    body,
  });

  return {
    written: true,
    noteId: note.id,
    matched: correlated.length,
    scanned: feed.stories.length,
    anchors: anchors.length,
  };
}
