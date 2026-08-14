// What kind of email a note came from.
//
// `source` says 'email' for 62% of the entities in the graph, and that one word
// covers three genuinely different things — a colleague writing to you, a
// service telling you your build failed, and a shop telling you about a sale.
// Filtering them together is why the source picker cannot narrow anything: the
// clusters that dominate it are mailshots, and there was no way to say so.
//
// The existing metadata cannot answer this. Every email note on production
// carries `autoKind: "file"` and `sourceTag: "file"` — constants, the same on
// all 1,740 of them, which looks like an ingest defect and is certainly not a
// classification. What IS present and populated on every note is
// `participants`, and the sender separates the three cleanly. Measured over the
// live mailbox, the top non-personal senders are:
//
//   noreply.github.com 114 · mailer.humblebundle.com 70 · linkedin.com 56 ·
//   amazon.co.uk 55 · eml.experian.co.uk 35 · vesta.threadloom.news 32 ·
//   tldrnewsletter.com 31 · send.nuubu.com 31 · product.totallymoney.com 30 ·
//   immail.fanatical.com 25 · alert.rightmove.co.uk 23
//
// The pattern is in the subdomain and the local part, not the organisation:
// `mailer.`, `send.`, `immail.`, `alert.`, `product.`, `news.`, `noreply@`.
//
// PURE — no DB, no clock, no network. The ingest calls it, the backfill calls
// it, and the tests call it directly.

export const EMAIL_KINDS = ['correspondence', 'notification', 'bulk'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/**
 * Subdomains and local parts that mark an address as a sending PLATFORM rather
 * than a correspondent. Deliberately matched as a labelled component, not as a
 * substring — "sendle.com" is a courier and "newsagent.co.uk" is a shop, and
 * neither is a bulk mailer.
 */
const BULK_LABELS = new Set([
  'mailer',
  'mail',
  'email',
  'em',
  'eml',
  'send',
  'sending',
  'immail',
  'news',
  'newsletter',
  'newsletters',
  'marketing',
  'campaign',
  'campaigns',
  'promo',
  'promotions',
  'offers',
  'deals',
  'product',
  'updates',
  'e',
  'mkt',
  'crm',
]);

/** Local parts that mark automated post regardless of the domain. */
const AUTOMATED_LOCALS = new Set([
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'notification',
  'alerts',
  'alert',
  'auto',
  'automated',
  'mailer-daemon',
  'bounce',
  'bounces',
]);

/** Local parts that mark marketing specifically. */
const MARKETING_LOCALS = new Set([
  'newsletter',
  'newsletters',
  'news',
  'marketing',
  'offers',
  'deals',
  'promotions',
  'promo',
  'hello',
  'team',
  'info',
  'contact',
]);

/** Subdomain labels that mark automated service post. */
const NOTIFICATION_LABELS = new Set(['noreply', 'notifications', 'notify', 'alert', 'alerts', 'ci']);

export interface EmailKindResult {
  kind: EmailKind;
  /** Sender address the decision was made from, lowercased. Null if none. */
  sender: string | null;
  /** Sender domain, lowercased — the facet the picker drills into. */
  domain: string | null;
  /** Why, in a few words, for the admin list. */
  reason: string;
}

/**
 * Classify from the participant list.
 *
 * The sender is taken as the first participant that is not the mailbox owner.
 * The Gmail ingest writes the thread's participants with the counterparty
 * first, and the owner appears on every thread by definition, so removing them
 * is what leaves the address that actually says something.
 */
export function classifyEmail(
  participants: readonly string[] | null | undefined,
  ownerAddresses: readonly string[] = [],
  overrides: ReadonlyMap<string, EmailKind> = new Map(),
): EmailKindResult {
  const owners = new Set(ownerAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const cleaned = (participants ?? [])
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter((p) => p.includes('@'));

  const sender = cleaned.find((p) => !owners.has(p)) ?? null;
  if (!sender) {
    // Only the owner on the thread — a note to self, or a thread whose
    // counterparty was never recorded. Not something to call bulk.
    return {
      kind: 'correspondence',
      sender: null,
      domain: null,
      reason: 'No counterparty recorded on the thread.',
    };
  }

  const [local, domain] = splitAddress(sender);
  if (!domain) {
    return { kind: 'correspondence', sender, domain: null, reason: 'Unparseable sender address.' };
  }

  // A curated verdict for this domain wins over every heuristic below.
  //
  // It has to, because the heuristics can only see the shape of an ADDRESS, and
  // a large share of automated post arrives from perfectly ordinary-looking
  // ones. Measured over the live mailbox, the residual "correspondence" bucket
  // still contained linkedin.com (56 notes), amazon.co.uk (55), uber.com (26)
  // and classdojo.com (24) — none of them correspondence, none of them
  // distinguishable from a colleague by their address alone. Thirty domains
  // cover most of the volume, so curating them is quick and permanent, and it
  // is the only thing that can be right about cases a pattern cannot reach.
  const decided = overrides.get(domain);
  if (decided) {
    return { kind: decided, sender, domain, reason: 'Classified by a rule you set for this domain.' };
  }

  const labels = domain.split('.');

  if (MARKETING_LOCALS.has(local) || labels.some((l) => BULK_LABELS.has(l))) {
    return {
      kind: 'bulk',
      sender,
      domain,
      reason: 'Sent from a marketing or bulk-mail address.',
    };
  }

  if (AUTOMATED_LOCALS.has(local) || labels.some((l) => NOTIFICATION_LABELS.has(l))) {
    return {
      kind: 'notification',
      sender,
      domain,
      reason: 'Automated service post — no-reply or notification sender.',
    };
  }

  return { kind: 'correspondence', sender, domain, reason: 'Sent from an ordinary address.' };
}

function splitAddress(address: string): [string, string | null] {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) return [address, null];
  return [address.slice(0, at), address.slice(at + 1)];
}
