import { buildNewsBrief } from '$lib/news/brief';
import type { ActivityHandler } from '../types';

const NAME = 'news-brief';

/**
 * Read the wire once a day and write down only what touches your work.
 *
 * Notifies nobody — it writes a notebook note read when the owner chooses to,
 * the same call `daydream-digest` makes and for the same reason.
 *
 * Once every 24 hours rather than hourly: the point is one considered pass, and
 * a brief that arrives six times a day is a feed with extra steps. No LLM — the
 * selection is the correlation rule the desk already runs, and the prose is
 * assembled from counts and our own entity names.
 *
 * A morning with nothing relevant reports `ok` with a reason, not `error`. The
 * wire not mentioning your work is the normal case, not a fault, and a handler
 * that cried failure on quiet days would be muted within a week.
 */
export const newsBrief: ActivityHandler = {
  name: NAME,
  description:
    'Reads the news desk once a day and writes one notebook note listing only the stories that correlate with the knowledge graph, with what you already hold on each. Notifies nobody. No LLM.',
  defaultCadenceSeconds: 24 * 3600,
  defaultEnabled: true,
  defaultConfig: {},

  async run() {
    const result = await buildNewsBrief();

    if (!result.written) {
      return {
        outcome: 'ok',
        summary: `no brief: ${result.reason ?? 'nothing to report'}`,
        details: { scanned: result.scanned, matched: result.matched, anchors: result.anchors },
      };
    }

    return {
      outcome: 'ok',
      summary: `${result.matched} of ${result.scanned} stories touched your work`,
      details: {
        noteId: result.noteId,
        matched: result.matched,
        scanned: result.scanned,
        anchors: result.anchors,
      },
    };
  },
};
