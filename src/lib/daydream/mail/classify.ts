// src/lib/daydream/mail/classify.ts
//
// The half of the mailbox nothing was reading.
//
// `offers.ts` scans email for vouchers. It reads `emailKind = 'bulk'` only, and
// it actively PENALISES the word "security" — correctly, because a password
// reset is not a discount. The consequence was that the 1,779 correspondence
// and notification emails on production were never looked at by anything, and
// the mail that actually matters lives in exactly that half:
//
//   2026-08-27  Regarding Your Microsoft Account
//   2026-08-27  Personal Microsoft account security code
//   2026-08-27  Your account recovery request
//   2026-08-27  Unrecognized device signed in to your OpenRouter account
//   2026-08-27  Security alert for <a second address>
//   2026-08-27  Security alert for <a third address>
//   2026-08-26  New sign-in to your OpenAI account
//   2026-08-28  Check your PAYE code change online
//
// Six account-security mails from four senders inside one day, and the engine
// said nothing, because the only thing pointed at the mailbox was a voucher
// scanner.
//
// ── Same shape as offers.ts, deliberately ───────────────────────────────────
//
// Weighted regex signals, anti-signals that cost points rather than veto, a
// floor per category. No model call: a rule that fires on a phrase can be
// tested exhaustively, and this decides whether a phone buzzes. The model's
// only job downstream is phrasing something a rule already found — the same
// argument as every other detector here.
//
// The hard discrimination is CODE. "Use code FREEDEL" is marketing; "Your
// single-use code" is a second factor arriving for a login somebody is
// attempting. They differ by one preceding word, so the offer vocabulary is an
// anti-signal here and the security vocabulary is an anti-signal there.

/** The four lanes, in the order a tie is broken. Security first: a mis-filed
 *  security mail is worse than a mis-filed anything else. */
export const MAIL_CATEGORIES = ['security', 'money_admin', 'official', 'unusual'] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export interface Signal {
  re: RegExp;
  weight: number;
  name: string;
}

/**
 * Account and access events. Weighted so a single soft word cannot reach the
 * floor on its own — "verify" appears in a great deal of ordinary onboarding —
 * while an unambiguous phrase clears it alone.
 */
export const SECURITY_SIGNALS: ReadonlyArray<Signal> = [
  { re: /\baccount recovery\b|\brecovery request\b|\brecover your account\b/i, weight: 5, name: 'recovery' },
  // "account HAS BEEN locked" is the commoner phrasing than "account locked";
  // the adjacent-words form missed every real one.
  { re: /\baccount (?:\w+\s+){0,3}(locked|suspended|compromised|disabled|closed|restricted)\b/i, weight: 5, name: 'account_locked' },
  { re: /\b(data )?breach\b|\bexposed in a\b/i, weight: 5, name: 'breach' },
  { re: /\bunrecogni[sz]ed\b|\bunfamiliar (device|location)\b/i, weight: 4, name: 'unrecognised' },
  { re: /\bunusual (activity|sign[- ]?in|login|access)\b|\bsuspicious (activity|sign[- ]?in|login)\b/i, weight: 4, name: 'unusual_activity' },
  { re: /\bnew sign[- ]?in\b|\bdid you (just )?sign in\b|\bsigned in to your\b/i, weight: 4, name: 'new_signin' },
  { re: /\b(login|log[- ]?in|sign[- ]?in) (notification|alert|attempt|activity)\b/i, weight: 4, name: 'signin_notice' },
  { re: /\bsecurity alert\b|\bsecurity notification\b/i, weight: 4, name: 'security_alert' },
  { re: /\bpassword (reset|change[d]?|expired)\b|\breset your password\b/i, weight: 4, name: 'password' },
  { re: /\bwas added to your account\b|\badded to your account\b/i, weight: 4, name: 'credential_added' },
  { re: /\b(two[- ]?factor|two[- ]?step|2fa|mfa|passkey|authenticator)\b/i, weight: 3, name: 'second_factor' },
  // "security code", "verification code", "single-use code", "access code" —
  // never a bare "code", which is the marketing sense.
  { re: /\b(security|verification|single[- ]use|one[- ]time|access|login|authentication) code\b/i, weight: 4, name: 'auth_code' },
  { re: /\bverify your (identity|email|account|info)\b|\bconfirm your identity\b/i, weight: 4, name: 'verify_identity' },
  { re: /\brecovery codes?\b/i, weight: 3, name: 'recovery_codes' },
  { re: /\b(oauth|third[- ]party) application\b|\bapp (access|permission)s?\b/i, weight: 2, name: 'oauth_grant' },
  { re: /\bshared some .* data with\b|\baccess to your\b/i, weight: 2, name: 'data_shared' },
  // Weak on its own by design — "your account" appears in a great deal of
  // ordinary mail. It exists to be added to a sender signal (see
  // IDENTITY_SENDERS): "Regarding Your Microsoft Account" carries no security
  // verb whatsoever, and is the exact mail that prompted this file.
  { re: /\b(your|my) [\w' ]{0,24}account\b|\baccount (details|settings|information)\b/i, weight: 2, name: 'account_noun' },
];

/** Money that has already happened or is about to, as distinct from money
 *  being advertised. The offer index owns the advertising. */
export const MONEY_SIGNALS: ReadonlyArray<Signal> = [
  { re: /\b(payment|transaction|direct debit|standing order|card) (was )?(failed|declined|returned|rejected|unsuccessful)\b/i, weight: 5, name: 'payment_failed' },
  { re: /\b(missed|late|overdue) payment\b|\barrears\b|\binsufficient funds\b|\boverdrawn\b/i, weight: 5, name: 'arrears' },
  { re: /\bdirect debit\b/i, weight: 4, name: 'direct_debit' },
  { re: /\b(price|subscription|plan|premium|tariff) (rise|increase|change|is (going up|changing|increasing))\b/i, weight: 4, name: 'price_rise' },
  { re: /\bwe'?re changing your\b|\bchanges to your (account|plan|policy|tariff)\b/i, weight: 3, name: 'terms_change' },
  { re: /\byour card (is )?(expir|declin)/i, weight: 4, name: 'card_expiring' },
  { re: /\b(auto[- ]?renew|renew(s|al|ing)?)\b/i, weight: 2, name: 'renewal' },
  { re: /\brefund (issued|processed|approved|on its way)\b/i, weight: 3, name: 'refund' },
  { re: /\binvoice (overdue|unpaid|due)\b|\bfinal (reminder|notice)\b/i, weight: 4, name: 'invoice_due' },
  { re: /\bfree trial (ends|ending|expires)\b|\btrial (ends|ending)\b/i, weight: 4, name: 'trial_ending' },
];

/** Government, health, school, utilities — dated obligations that arrive by
 *  email and are in nobody's calendar. */
export const OFFICIAL_SIGNALS: ReadonlyArray<Signal> = [
  { re: /\b(hmrc|paye|self[- ]assessment|tax code|national insurance|tax return)\b/i, weight: 5, name: 'hmrc' },
  { re: /\b(dvla|driving licence|driving license|\bmot\b|vehicle tax|v5c)\b/i, weight: 5, name: 'dvla' },
  { re: /\b(court|summons|jury service|tribunal)\b/i, weight: 5, name: 'legal' },
  { re: /\bnhs\b|\bgp (surgery|practice|appointment)\b|\bprescription\b|\bvaccination\b/i, weight: 4, name: 'nhs' },
  { re: /\bcouncil tax|electoral (register|roll)|planning (application|permission)\b/i, weight: 4, name: 'council' },
  { re: /\bpassport\b|\bvisa application\b|\bright to work\b/i, weight: 4, name: 'passport' },
  { re: /\bappointment (is |has been )?(confirm|remind|chang|cancel|book|resched)/i, weight: 3, name: 'appointment' },
  { re: /\byour appointment\b|\bappointment (letter|details)\b/i, weight: 3, name: 'appointment_noun' },
  { re: /\b(parents'? evening|term dates?|school (closure|report|trip)|inset day)\b/i, weight: 3, name: 'school' },
  { re: /\b(meter reading|energy (statement|bill)|water (bill|meter))\b/i, weight: 3, name: 'utility' },
];

/**
 * Costs points in every category.
 *
 * An anti-signal never vetoes outright, for the same reason it does not in
 * offers.ts: a real notice can arrive inside a marketing template. It just has
 * to be a stronger match to survive.
 */
export const MAIL_ANTI_SIGNALS: ReadonlyArray<{ re: RegExp; name: string; weight: number }> = [
  // The marketing sense of "code", and its neighbours.
  // The lookbehind is load-bearing: "single-use code" contains "use code", so
  // a bare \buse code\b cancelled the very security signal it sits next to and
  // scored a genuine second factor at zero.
  { re: /(?<![-\w])use code\b|\bpromo(?:\s|-)?code\b|\bdiscount code\b|\bcode:\s*[A-Z0-9]{4,}/i, name: 'promo_code', weight: 4 },
  { re: /\b\d{1,3}\s?% ?(off|discount)\b/i, name: 'percent_off', weight: 3 },
  // "Sign Up Now and Beat the Price Rise" is an advert, and it matched
  // `price_rise` cleanly — the only thing separating it from a real tariff
  // letter is the call to action.
  { re: /\b(sale|clearance|shop now|buy now|bestseller|new in|sign up (now|today)|join (now|today)|beat the|limited stock|last chance)\b/i, name: 'retail', weight: 3 },
  { re: /\bunsubscrib/i, name: 'unsubscribe', weight: 2 },
  { re: /\b(newsletter|digest|round[- ]?up|this week in|weekly|monthly)\b/i, name: 'digest', weight: 3 },
  // CI mail from GitHub is not an account event, and there is a lot of it.
  // GitHub's genuine account mail ("a passkey was added") does not match this.
  { re: /\b(pr run|workflow run|build|pipeline|job) (failed|passed|succeeded|cancelled)\b/i, name: 'ci_noise', weight: 6 },
  { re: /^\[[\w.-]+\/[\w.-]+\]/, name: 'repo_prefix', weight: 3 },
  // Rewards programmes borrow security vocabulary ("you've unlocked…").
  { re: /\b(unlocked|you'?ve earned|loyalty|rewards? (level|tier|points))\b/i, name: 'loyalty', weight: 3 },
];

/**
 * Domains whose mail is, by the nature of the sender, about access to an
 * account rather than about buying something.
 *
 * This is a WEIGHT, never a verdict. "Regarding Your Microsoft Account" scores
 * 2 on vocabulary alone — no security verb appears in it anywhere — and would
 * sit under every floor for ever. What makes it worth a look is that Microsoft
 * sent it and it is about an account. Marketing from the same domain still
 * loses the points again to the retail anti-signals, so a Microsoft Store
 * promotion does not become a security event.
 *
 * Matched on the registrable tail, so `security.microsoft.com`,
 * `account.microsoft.com` and `microsoft.com` are one entry.
 */
export const IDENTITY_SENDERS: ReadonlyArray<RegExp> = [
  /(^|\.)microsoft\.com$/i,
  /(^|\.)live\.com$/i,
  /(^|\.)google(mail)?\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)apple\.com$/i,
  /(^|\.)icloud\.com$/i,
  /(^|\.)github\.com$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)openrouter\.ai$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)amazon(aws)?\.(com|co\.uk)$/i,
  /(^|\.)paypal\.(com|co\.uk)$/i,
  /(^|\.)coinbase\.com$/i,
  /(^|\.)backblaze\.com$/i,
  /(^|\.)hetzner\.(com|de)$/i,
  /(^|\.)cloudflare\.com$/i,
  /(^|\.)dropbox\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)facebook(mail)?\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)truelayer\.com$/i,
  /(^|\.)virginmoney\.com$/i,
  /(^|\.)monzo\.com$/i,
  /(^|\.)starlingbank\.com$/i,
  /(^|\.)nationwide\.co\.uk$/i,
  /(^|\.)barclays\.co\.uk$/i,
  /(^|\.)hsbc\.co\.uk$/i,
  /(^|\.)lloydsbank\.co\.uk$/i,
  /(^|\.)natwest\.com$/i,
  /(^|\.)santander\.co\.uk$/i,
];

/** How much an identity sender is worth. Enough to lift a bland but genuine
 *  account subject over the floor; never enough to carry a subject on its own,
 *  since the weakest security signal is 2 and the floor is 4. */
export const IDENTITY_SENDER_WEIGHT = 2;

/** Government and public-body senders, the `official` equivalent. */
export const OFFICIAL_SENDERS: ReadonlyArray<RegExp> = [
  /(^|\.)gov\.uk$/i,
  /(^|\.)nhs\.uk$/i,
  /(^|\.)nhs\.net$/i,
  /(^|\.)police\.uk$/i,
  /(^|\.)sch\.uk$/i,
  /(^|\.)ac\.uk$/i,
];

function matchesAny(domain: string, list: ReadonlyArray<RegExp>): boolean {
  return list.some((re) => re.test(domain));
}

/** Per-category floor. Security sits lowest because its evidence is the most
 *  distinctive; `unusual` has no keyword floor at all — it is decided by
 *  novelty in scan.ts, not by vocabulary. */
export const MAIL_FLOORS: Record<Exclude<MailCategory, 'unusual'>, number> = {
  security: 4,
  money_admin: 4,
  official: 4,
};

const CATEGORY_SIGNALS: Record<Exclude<MailCategory, 'unusual'>, ReadonlyArray<Signal>> = {
  security: SECURITY_SIGNALS,
  money_admin: MONEY_SIGNALS,
  official: OFFICIAL_SIGNALS,
};

/** What the classifier is allowed to see. Subject carries most of it; the
 *  sender carries the rest, and `emailKind` keeps bulk marketing out of the
 *  lanes that are supposed to be about consequences. */
export interface MailInput {
  subject: string | null | undefined;
  senderDomain?: string | null;
  /** 'bulk' | 'correspondence' | 'notification', as the intel ingest filed it. */
  emailKind?: string | null;
}

export interface MailClassification {
  category: MailCategory | null;
  score: number;
  matched: string[];
  blocked: string[];
  /** Every category that cleared its floor, best first. Kept so a card can say
   *  "security, and also money" rather than silently picking one. */
  alsoMatched: MailCategory[];
}

const EMPTY: MailClassification = { category: null, score: 0, matched: [], blocked: [], alsoMatched: [] };

/**
 * Which lane, if any, this subject line belongs to.
 *
 * PURE. Stage one of the same two-stage shape offers.ts uses: this costs
 * nothing and can be tested against every real subject line on production,
 * which is where the fixtures in the test file came from.
 */
export function classifyMail(input: MailInput): MailClassification {
  const text = (input.subject ?? '').trim();
  if (!text) return EMPTY;

  const anti = MAIL_ANTI_SIGNALS.filter((a) => a.re.test(text));
  const penalty = anti.reduce((a, s) => a + s.weight, 0);
  const blocked = anti.map((a) => a.name);

  const domain = (input.senderDomain ?? '').trim().toLowerCase();
  const identitySender = domain ? matchesAny(domain, IDENTITY_SENDERS) : false;
  const officialSender = domain ? matchesAny(domain, OFFICIAL_SENDERS) : false;

  const scored = (Object.keys(CATEGORY_SIGNALS) as Array<Exclude<MailCategory, 'unusual'>>)
    .map((category) => {
      const hits = CATEGORY_SIGNALS[category].filter((s) => s.re.test(text));
      const raw = hits.reduce((a, s) => a + s.weight, 0);
      // The sender only counts once the subject has said something at all —
      // otherwise every newsletter from google.com would score 2 for nothing.
      const senderBonus =
        raw === 0
          ? 0
          : category === 'security' && identitySender
            ? IDENTITY_SENDER_WEIGHT
            : category === 'official' && officialSender
              ? IDENTITY_SENDER_WEIGHT
              : 0;
      const score = Math.max(0, raw + senderBonus - penalty);
      return {
        category,
        score,
        matched: [...hits.map((h) => h.name), ...(senderBonus ? ['identity_sender'] : [])],
        clears: score >= MAIL_FLOORS[category],
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || MAIL_CATEGORIES.indexOf(a.category) - MAIL_CATEGORIES.indexOf(b.category));

  const winner = scored.find((c) => c.clears);
  if (!winner) {
    return { ...EMPTY, score: scored[0]?.score ?? 0, matched: scored[0]?.matched ?? [], blocked };
  }

  return {
    category: winner.category,
    score: winner.score,
    matched: winner.matched,
    blocked,
    alsoMatched: scored.filter((c) => c.clears).map((c) => c.category),
  };
}

/**
 * A brand as a person would say it, from a sender domain.
 *
 * `security.microsoft.com` → "Microsoft". Purely cosmetic, and deliberately
 * dumb: it drops the public suffix and the common sending subdomains and
 * title-cases what is left. A wrong answer here reads slightly odd; it never
 * changes what is flagged.
 */
export function senderBrand(domain: string | null | undefined): string | null {
  const d = (domain ?? '').trim().toLowerCase();
  if (!d) return null;
  const parts = d.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // Strip the public suffix — one label, or two for the co.uk family.
  const suffixLen = parts.length >= 3 && /^(co|org|gov|ac|net|sch)$/.test(parts[parts.length - 2]) ? 2 : 1;
  const base = parts.slice(0, parts.length - suffixLen);
  const NOISE = new Set([
    'email', 'mail', 'e', 'em', 'send', 'sender', 'sendgrid', 'mailer', 'notify',
    'notification', 'notifications', 'noreply', 'no-reply', 'reply', 'news',
    'marketing', 'info', 'updates', 'account', 'accounts', 'alerts', 'go', 'links',
    'click', 'track', 'smtp', 'bounce', 'msg', 'message', 'contact', 'hello', 'uk-info',
    'googlemail',
  ]);
  const meaningful = base.filter((p) => !NOISE.has(p));
  const pick = meaningful[meaningful.length - 1] ?? base[base.length - 1];
  if (!pick) return null;
  return pick
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Subject-only convenience. Equivalent to `classifyMail({ subject })`; the
 *  sender-blind path, kept because most of the vocabulary stands alone. */
export function classifyMailSubject(subject: string | null | undefined): MailClassification {
  return classifyMail({ subject });
}
