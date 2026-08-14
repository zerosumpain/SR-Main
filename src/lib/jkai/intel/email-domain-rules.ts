// Per-domain verdicts on what kind of email a sender sends.
//
// The heuristic in ./email-kind reads the shape of an address, which catches
// every ESP-style sender — `mailer.`, `send.`, `noreply@` — and cannot catch
// anything else. Measured over the live mailbox it left linkedin.com (56
// notes), amazon.co.uk (55), uber.com (26) and classdojo.com (24) sitting in
// "correspondence", because those send from perfectly ordinary brand domains
// and nothing in the address distinguishes them from a colleague.
//
// No pattern will ever reach those, so the answer is not a cleverer pattern. It
// is a list the user owns: about thirty domains cover most of the volume, so
// curating them once is quick and permanent, and a rule set by hand is the only
// thing that can be right about a case a heuristic cannot see.
//
// Datastore-backed, per the house rule — no schema change, and the rules are
// editable without a deploy.
import { ensureCollection, upsertRecord, queryRecords, deleteRecord } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { EMAIL_KINDS, type EmailKind } from './email-kind';

export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this discards every rule the user has set. */
export const EMAIL_DOMAIN_RULES_COLLECTION = 'intel_email_domain_rules';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

const PAGE = 200;

export interface EmailDomainRule {
  domain: string;
  kind: EmailKind;
  /** How many notes carried this domain when the rule was made. */
  noteCount?: number;
  setAt: string;
}

/**
 * Seeds for the domains the heuristic demonstrably gets wrong, taken from the
 * live mailbox rather than guessed. Applied once, on first use, and editable
 * afterwards like any other rule.
 */
export const SEED_DOMAIN_RULES: ReadonlyArray<{ domain: string; kind: EmailKind }> = [
  // Social and marketplace broadcasters that send from an ordinary domain.
  { domain: 'linkedin.com', kind: 'bulk' },
  { domain: 'flipboard.com', kind: 'bulk' },
  { domain: 'tldrnewsletter.com', kind: 'bulk' },
  { domain: 'pmg.academy', kind: 'bulk' },
  { domain: 'thelostestate.com', kind: 'bulk' },
  // Transactional post from services in use — real, but not correspondence.
  { domain: 'amazon.co.uk', kind: 'notification' },
  { domain: 'uber.com', kind: 'notification' },
  { domain: 'classdojo.com', kind: 'notification' },
  { domain: 'googlemail.com', kind: 'notification' },
];

export async function ensureEmailDomainRules(): Promise<void> {
  await ensureCollection(
    EMAIL_DOMAIN_RULES_COLLECTION,
    {
      name: 'Intel Email Domain Rules',
      description:
        'What kind of email each sender domain sends — overrides the address-shape heuristic.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

export async function listEmailDomainRules(): Promise<EmailDomainRule[]> {
  await ensureEmailDomainRules();
  const out: EmailDomainRule[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = await queryRecords(
      EMAIL_DOMAIN_RULES_COLLECTION,
      { limit: PAGE, offset, sort: { path: 'domain', dir: 'asc' } },
      SYSTEM_ACTOR,
    );
    for (const record of records) out.push(record.data as unknown as EmailDomainRule);
    if (records.length < PAGE) break;
  }
  return out;
}

/** Domain → kind, ready for `classifyEmail`. Never throws. */
export async function emailDomainOverrides(): Promise<Map<string, EmailKind>> {
  try {
    const rules = await listEmailDomainRules();
    return new Map(rules.map((r) => [r.domain.toLowerCase(), r.kind]));
  } catch (err) {
    // Ingest must not stop because a rule list could not be read; the heuristic
    // alone is a worse answer, not a broken one.
    console.warn('[intel] email domain rules unavailable; using the heuristic alone', err);
    return new Map();
  }
}

export async function setEmailDomainRule(
  domain: string,
  kind: EmailKind,
  noteCount?: number,
): Promise<void> {
  const key = domain.trim().toLowerCase();
  if (!key) throw new Error('a domain rule needs a domain');
  if (!(EMAIL_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown email kind: ${kind}`);
  }
  await ensureEmailDomainRules();
  const rule: EmailDomainRule = { domain: key, kind, noteCount, setAt: new Date().toISOString() };
  await upsertRecord(
    EMAIL_DOMAIN_RULES_COLLECTION,
    { key, data: rule as unknown as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
}

export async function clearEmailDomainRule(domain: string): Promise<void> {
  await ensureEmailDomainRules();
  await deleteRecord(
    EMAIL_DOMAIN_RULES_COLLECTION,
    { key: domain.trim().toLowerCase() },
    SYSTEM_ACTOR,
  );
}

/** Apply the measured seeds, skipping any domain that already has a rule. */
export async function seedEmailDomainRules(): Promise<number> {
  const existing = new Set((await listEmailDomainRules()).map((r) => r.domain));
  let added = 0;
  for (const seed of SEED_DOMAIN_RULES) {
    if (existing.has(seed.domain)) continue;
    await setEmailDomainRule(seed.domain, seed.kind);
    added++;
  }
  return added;
}
