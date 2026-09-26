/**
 * Whether a thread's title is a stand-in rather than a name.
 *
 * The web leaves a new thread's title NULL, and the first reply writes one from
 * the opening message. The iPhone app opens every thread as "New thread", so
 * that rule never fired for it: ten turns in, the 2026-09-25 thread about a
 * photo was still "New thread", and so was the /drive folder its photo was
 * filed in, alongside every other photo sent from the phone.
 */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase();
  return t === '' || t === 'new thread';
}

/** Longest title written from an opening message. */
export const TITLE_MAX_CHARS = 60;

/**
 * A thread's name, from the message that opened it.
 *
 * Was `message.slice(0, 50)`: a hard cut, so the thread list read "Summarise my
 * health data for today — sleep, recove". One line, markdown and a leading
 * greeting's punctuation stripped, cut at the last whole word with an ellipsis.
 * Null when there is nothing to name it by (an attachment with no text) — the
 * caller keeps the title empty and the next turn tries again.
 */
export function titleFromMessage(message: string | null | undefined, max = TITLE_MAX_CHARS): string | null {
  const flat = (message ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const words = space >= max / 2 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s,.;:!?—–-]+$/, '')}…`;
}
