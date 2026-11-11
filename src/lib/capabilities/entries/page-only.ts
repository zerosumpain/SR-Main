import type { CapabilityEntry } from '../types';

// What chat deliberately does NOT do, and what each surface of the site is
// covered by (workflow knit 2026-11-11, slice 6).
//
// A surface is a phone route family (the first path segment under
// `/api/native/`), a notification category or a platform event type. Each one
// is either covered by a capability row (its `native` screen, its id, or the
// row or tool named in COVERED_BY) or listed in PAGE_ONLY with the reason it
// has no tool. `surface-guard.test.ts` fails when a surface has neither, so a
// new feature cannot ship without somebody deciding which it is.
//
// PURE, like the rest of `$lib/capabilities`. Neither list is part of the
// manifest: they are not in `capabilities.generated.json` and never reach the
// catalogue, the prompt or jkai_help. They exist for the guard and for the
// next person asking "why can't chat do that?".

export interface PageOnlyEntry {
  /** `native:<family>`, `notify:<category>`, `event:<type>` or `action:<what>`. */
  key: string;
  /** One plain sentence: why this has no tool. */
  reason: string;
}

export const PAGE_ONLY: readonly PageOnlyEntry[] = [
  // Decided: these stay on their page (spec decision log, workflow knit).
  { key: 'action:pull-merge', reason: 'Merging, closing or reverting a pull request deploys to production; it is pressed on the release desk, where the diff and the checks are in view.' },
  { key: 'action:app-release', reason: 'Releasing an app build pushes it to the family\'s phones; the owner tests it first and presses release himself.' },
  { key: 'action:alarm-raise', reason: 'Raising or holding the family alarm reaches every family phone; it is only ever pressed by a person in the app.' },
  { key: 'action:share-link-write', reason: 'Making or revoking a share link, or setting its password, publishes private project pages; it is done on the project page.' },
  { key: 'action:daydream-send', reason: 'Sending a daydream to someone and changing the autonomy level change what leaves the site unattended; both stay on the daydream pages.' },
  { key: 'action:bank-reconnect', reason: 'Reconnecting a bank or an OAuth account is a consent screen in a browser; chat cannot and should not hold it.' },
  { key: 'action:trip-decision', reason: 'Deciding a trip proposal is made on the trip page, beside the plan it changes.' },
  { key: 'action:people-location', reason: 'Where family members are is the most sensitive data the site holds; it is held out of chat by decision (the people-location row stays planned).' },

  // Phone plumbing: the app's own sign-in, pairing and delivery. Nothing here is a thing to ask jkai for.
  { key: 'native:account', reason: 'Deleting an account erases a person; it is done by that person on their own phone.' },
  { key: 'native:app-release', reason: 'Releasing an app build to the family stays with the owner on the page or his phone (see action:app-release).' },
  { key: 'native:app-update', reason: 'The installed app asking whether a newer copy exists; there is nothing to read or do from chat.' },
  { key: 'native:chat', reason: 'The transport that carries jkai turns to and from the phone, not a feature jkai acts on.' },
  { key: 'native:companion-pair', reason: 'Pairing a phone with the companion server mints a credential; credentials are never handled by a tool.' },
  { key: 'native:companion-policy', reason: 'A service-to-service read of the household policy for the companion server; not a person-facing feature.' },
  { key: 'native:me', reason: 'The phone checking its own token; not a person-facing feature.' },
  { key: 'native:notifications', reason: 'The phone collecting its notification inbox and routing settings; routing is changed on the phone, per person.' },
  { key: 'native:pair', reason: 'Pairing a phone mints a credential; credentials are never handled by a tool.' },
  { key: 'native:push', reason: 'The phone registering its push token; not a person-facing feature.' },
  { key: 'native:register', reason: 'A person asking to join, and taking the request back; approving access changes who can sign in and stays on the access page.' },
  { key: 'native:review-demo', reason: 'The store reviewer\'s demo switch; not a person-facing feature.' },
  { key: 'native:route-gifts', reason: 'Sending a recorded route to a family member shares a trail of where someone went; trails stay out of chat.' },
  { key: 'native:route-session', reason: 'Live route sharing is somebody\'s live location; it is held out of chat with people-location.' },
  { key: 'native:session', reason: 'The phone signing in and out; credentials are never handled by a tool.' },

  { key: 'notify:access', reason: 'Somebody asking to join the site; approving changes who can sign in and stays on the access page.' },
  { key: 'notify:chat', reason: 'jkai\'s own reply-ready notifications; the thread is the feature, and it is already where the owner is.' },
];

/**
 * A surface → the capability row id, or the tool of a live row, that covers it,
 * where the row's `native` screen or id does not already say so.
 */
export const COVERED_BY: Readonly<Record<string, string>> = {
  'native:connections': 'estate',
  'native:drive': 'files',
  'native:news': 'news',

  'notify:build': 'builds',
  'notify:deploy': 'releases',
  'notify:uptime': 'estate_status',
  'notify:connections': 'connector_status',
  'notify:reminder': 'followups',
  'notify:drive': 'files',
  'notify:system': 'event_monitor_list',

  'event:workflow.completed': 'workflows',
  'event:notification.raised': 'event_monitor_create',
  'event:whatsapp.inbound': 'whatsapp',
  'event:news.item': 'news',
  'event:health.summary_changed': 'health',
  'event:connector.broken': 'connector_status',
  'event:connector.recovered': 'connector_status',
  'event:alexa.utterance': 'alexa',
  'event:family.alert': 'family_alarm_status',
  'event:wishlist.offer': 'wishlist_offers',
  'event:trip.needs_you': 'trip_open_items',
  'event:share.opened': 'share_links',
  'event:capture.ready': 'captures',
  'event:release.live': 'releases_status',
  'event:pull.opened': 'pulls_list',
  'event:game.finished': 'games',
  'event:daydream.acted': 'solutions_register',
};

const SURFACE_KINDS = ['native', 'notify', 'event'] as const;

/**
 * The guard, as a PURE function so the test can prove it bites. Returns one
 * sentence per problem; empty means every surface is decided.
 */
export function surfaceProblems(
  surfaces: readonly string[],
  rows: readonly CapabilityEntry[],
  pageOnly: readonly PageOnlyEntry[] = PAGE_ONLY,
  coveredBy: Readonly<Record<string, string>> = COVERED_BY,
): string[] {
  const problems: string[] = [];
  const known = new Set(surfaces);
  const rowIds = new Set(rows.map((r) => r.id));
  const liveTools = new Set(rows.filter((r) => r.status !== 'planned').flatMap((r) => r.tools));
  const held = new Map<string, string>();
  for (const e of pageOnly) {
    if (held.has(e.key)) problems.push(`${e.key}: listed page-only twice`);
    held.set(e.key, e.reason);
    if (e.reason.trim().length < 30) problems.push(`${e.key}: a page-only entry states its reason in a sentence`);
    const kind = e.key.split(':')[0];
    if (kind !== 'action' && !(SURFACE_KINDS as readonly string[]).includes(kind)) problems.push(`${e.key}: unknown kind of page-only key`);
    if (kind !== 'action' && !known.has(e.key)) problems.push(`${e.key}: page-only, but there is no such surface any more`);
  }
  for (const [key, target] of Object.entries(coveredBy)) {
    if (!known.has(key)) problems.push(`${key}: covered by ${target}, but there is no such surface any more`);
    if (!rowIds.has(target) && !liveTools.has(target)) problems.push(`${key}: covered by ${target}, which is neither a capability row nor a tool of a live row`);
    if (held.has(key)) problems.push(`${key}: both covered by ${target} and page-only`);
  }
  for (const key of surfaces) {
    if (held.has(key) || key in coveredBy) continue;
    const name = key.slice(key.indexOf(':') + 1);
    const direct = key.startsWith('native:') ? rows.some((r) => r.native === name || r.id === name) : rowIds.has(name);
    if (!direct) problems.push(`${key}: has neither a capability row nor a page-only entry — give it a tool and a row, or say in page-only.ts why it has none`);
  }
  return problems;
}
