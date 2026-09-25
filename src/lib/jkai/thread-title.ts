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
