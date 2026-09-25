// Lives in $lib/constants, not beside notifyOwner in $lib/server/notify, so the
// client-safe `notify` workflow node definition can offer the categories as a
// dropdown: nothing under $lib/server may reach the browser. The server module
// re-exports it and keeps the lookups.
/**
 * Everything the site can tell you about, named once.
 *
 * A category is the unit a person routes. Not an event type — there are dozens
 * of those and nobody wants a switchboard — and not a severity, because "tell
 * me about builds on WhatsApp and health on the phone" is a sentence about
 * subject matter, not urgency.
 *
 * The defaults reproduce today's behaviour as closely as a routed system can:
 * everything that currently reaches WhatsApp keeps reaching WhatsApp. Native is
 * on as well, because the phone collecting a copy costs nothing and an empty
 * inbox on the first run looks like a broken feature.
 *
 * `minIntervalSeconds` is a floor between two notifications IN THE SAME
 * category. Health's three hours is John's, stated in the brief; the rest are 0
 * because a build result and a deploy failure are events, not readings, and
 * suppressing the second one loses information rather than noise.
 */
export interface NotificationCategory {
  id: string;
  label: string;
  /** One line, shown under the label on the phone's settings screen. */
  description: string;
  whatsapp: boolean;
  native: boolean;
  minIntervalSeconds: number;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    id: 'health',
    label: 'Health',
    description: 'Recovery, HRV, resting heart rate and sleep, when they move.',
    whatsapp: false,
    native: true,
    // Three hours, from the brief. The watcher polls far more often than this;
    // the floor is what makes that safe.
    minIntervalSeconds: 3 * 60 * 60,
  },
  {
    id: 'chat',
    label: 'jkai',
    description: 'A turn that finished while you were away, or one waiting on you.',
    // NOT WhatsApp by default, and this is the one default that is not simply
    // "keep today's behaviour". These alerts previously reached NOTHING — the
    // push shim they went through was empty — and chat already escalates to
    // WhatsApp by another path (`wa-escalation.ts`). Routing them there too
    // would double a channel rather than restore one.
    whatsapp: false,
    native: true,
    minIntervalSeconds: 0,
  },
  {
    id: 'build',
    label: 'Builds',
    description: 'Autonomous builds and workflow runs reaching a terminal state.',
    whatsapp: true,
    native: true,
    minIntervalSeconds: 0,
  },
  {
    id: 'deploy',
    label: 'Deploys',
    description: 'Releases, and anything that stopped one reaching production.',
    whatsapp: true,
    native: true,
    minIntervalSeconds: 0,
  },
  {
    id: 'uptime',
    label: 'Uptime',
    description: 'A service that stopped answering, and when it came back.',
    whatsapp: true,
    native: true,
    minIntervalSeconds: 0,
  },
  {
    id: 'intel',
    label: 'Intel',
    description: 'High-significance alerts from the intelligence engine.',
    whatsapp: true,
    native: true,
    minIntervalSeconds: 0,
  },
  {
    id: 'news',
    label: 'News',
    description: 'A story the desk ranked high enough to interrupt you for.',
    whatsapp: false,
    native: true,
    minIntervalSeconds: 60 * 60,
  },
  {
    id: 'daydream',
    label: 'Daydream',
    description: 'Something the engine noticed on its spare cycles — an anomaly, a proposal, a plan.',
    // Phone AND WhatsApp, like every alert that reached WhatsApp before: the
    // ponder musings this replaces went there, and the owner rates them by
    // replying. Either is one switch away on the phone.
    whatsapp: true,
    native: true,
    // Per NOTE, not per category: the think loop passes each note's own dedupe
    // key, so this only stops the same note being raised twice in a day. The
    // rate limit is the loop itself — at most two notes a cycle, one cycle
    // every 45 minutes in waking hours — and a category-wide floor would
    // silently eat the second note of every cycle.
    minIntervalSeconds: 24 * 60 * 60,
  },
  {
    id: 'connections',
    label: 'Connections that need you',
    description: 'An account that needs signing in again, or a service that stopped working.',
    whatsapp: true,
    native: true,
    // The reminder cadence. The connector watcher checks every 30 minutes and
    // tells you on the transition; while it stays broken, this floor — scoped
    // per connector by the dedupe key — is what makes the next message a
    // twice-daily reminder rather than a half-hourly nag.
    minIntervalSeconds: 12 * 60 * 60,
  },
  {
    id: 'system',
    label: 'Everything else',
    description: 'Anything that has not been given a category of its own yet.',
    whatsapp: true,
    native: true,
    minIntervalSeconds: 0,
  },
] as const;
