// Has John's writing moved away from the card that describes it?
//
// The corpus grows. Every new post he writes shifts the numbers the card was
// built from, and a card that describes his 2026 prose will eventually be
// telling models to imitate a writer he has stopped being. This compares a fresh
// measurement against the committed card and says what moved.
//
// IT PROPOSES. IT NEVER APPLIES. Rebuilding the card is a deliberate act with a
// commit behind it, because the card is the one description of how everything
// writes and a silent overnight change to it would be untraceable. The job's
// entire output is a note.
//
// Pure — no DB, no filesystem. `drift-engine.ts` supplies the measurement.

import type { VoiceCard, Measured, Register } from './types';

export type DriftItem = {
  metric: string;
  was: number;
  now: number;
  /** Signed, as a percentage of the old value. 0 when the old value was 0. */
  changePct: number;
  material: boolean;
  note: string;
};

export type DriftReport = {
  register: Register;
  cardVersion: number;
  cardBuiltAt: string;
  corpusThen: { posts: number; words: number };
  corpusNow: { posts: number; words: number };
  /** Posts the card has never seen. The clearest reason to rebuild. */
  newPosts: number;
  items: DriftItem[];
  /** True when anything crossed a threshold, or new posts have appeared. */
  material: boolean;
  summary: string;
};

/**
 * How far a measure may move before it is worth mentioning.
 *
 * These are generous. On a corpus of five posts a single new one moves every
 * number, and a job that cried drift every month would train John to ignore it —
 * which is worse than not having it. The thresholds are about being worth
 * reading, not about statistical significance, and the report says so.
 */
const THRESHOLD_PCT = 25;

/** Below this, a percentage change is arithmetic noise on a small base. */
const MIN_ABSOLUTE_MOVE: Record<string, number> = {
  'sentence median (words)': 3,
  'sentence p90 (words)': 6,
  'reading ease': 6,
  'first person / 1k': 8,
  'contractions / 1k': 6,
  'em dashes / 1k': 3,
  'colons / 1k': 1,
  'short sentences (%)': 8,
};

function pct(was: number, now: number): number {
  if (was === 0) return now === 0 ? 0 : 100;
  return Math.round(((now - was) / Math.abs(was)) * 100);
}

function item(metric: string, was: number, now: number, note: string): DriftItem {
  const changePct = pct(was, now);
  const floor = MIN_ABSOLUTE_MOVE[metric] ?? 0;
  const material = Math.abs(changePct) >= THRESHOLD_PCT && Math.abs(now - was) >= floor;
  return {
    metric,
    was: Math.round(was * 100) / 100,
    now: Math.round(now * 100) / 100,
    changePct,
    material,
    note,
  };
}

export function compareDrift(
  card: VoiceCard,
  fresh: Measured,
  register: Register = 'public-prose',
): DriftReport {
  const then = card.registers[register]?.measured;

  if (!then) {
    return {
      register,
      cardVersion: card.version,
      cardBuiltAt: card.builtAt,
      corpusThen: { posts: 0, words: 0 },
      corpusNow: { posts: fresh.posts, words: fresh.words },
      newPosts: fresh.posts,
      items: [],
      material: true,
      summary: `The card has no measurements for the ${register} register, so there is nothing to compare against. Build it.`,
    };
  }

  const items = [
    item('sentence median (words)', then.sentenceWords.median, fresh.sentenceWords.median,
      'How long his sentences run. The card tells models not to chop them short.'),
    item('sentence p90 (words)', then.sentenceWords.p90, fresh.sentenceWords.p90,
      'The long tail. Moves when he starts writing tighter or looser.'),
    item('reading ease', then.fleschReadingEase, fresh.fleschReadingEase,
      'Flesch. Both directions matter — the scorer flags text far above or below him.'),
    item('first person / 1k', then.rates.firstPerson, fresh.rates.firstPerson,
      'The strongest single signal separating him from model prose.'),
    item('contractions / 1k', then.rates.contractions, fresh.rates.contractions,
      'Spoken versus written register.'),
    item('em dashes / 1k', then.rates.emDash, fresh.rates.emDash,
      'The scorer treats an em-dash shower as a tell; the ceiling is derived from this.'),
    item('colons / 1k', then.rates.colon, fresh.rates.colon,
      'He has never used one in a post. If this leaves zero, the scorer rule must go.'),
    item('short sentences (%)', then.shortSentenceRate * 100, fresh.shortSentenceRate * 100,
      'Share of sentences of five words or fewer.'),
  ];

  const newPosts = Math.max(0, fresh.posts - then.posts);
  const moved = items.filter((i) => i.material);
  const material = moved.length > 0 || newPosts > 0;

  const parts: string[] = [];
  if (newPosts > 0) {
    parts.push(
      `${newPosts} post${newPosts === 1 ? '' : 's'} the card has never seen ` +
        `(${then.posts} → ${fresh.posts}, ${then.words.toLocaleString('en-GB')} → ${fresh.words.toLocaleString('en-GB')} words).`,
    );
  }
  if (moved.length > 0) {
    parts.push(
      `${moved.length} measure${moved.length === 1 ? '' : 's'} moved past the ${THRESHOLD_PCT}% mark: ` +
        moved.map((i) => `${i.metric} ${i.was} → ${i.now}`).join('; ') + '.',
    );
  }
  if (parts.length === 0) {
    parts.push(`Nothing moved past the ${THRESHOLD_PCT}% mark and no new posts. The card still describes him.`);
  } else {
    parts.push(
      'Rebuild with `scripts/build-voice-card.ts --write`, then `scripts/sync-voice.sh`, and commit ' +
        'the result. Nothing has been changed automatically.',
    );
  }

  return {
    register,
    cardVersion: card.version,
    cardBuiltAt: card.builtAt,
    corpusThen: { posts: then.posts, words: then.words },
    corpusNow: { posts: fresh.posts, words: fresh.words },
    newPosts,
    items,
    material,
    summary: parts.join(' '),
  };
}
