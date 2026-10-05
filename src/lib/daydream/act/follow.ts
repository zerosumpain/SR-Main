// src/lib/daydream/act/follow.ts
//
// Taking a note further: the things jkai can do with a suggestion beyond the
// one diary/reminder/draft step "Do it for me" carries out (`plan.ts`). PURE —
// which follow-ups a note is offered, what each costs, how they are stored and
// read back. The work is `follow.server.ts`.
//
// Owner, 2026-10-05: a suggestion to try a physics prototype could go to the
// backlog to be built; a watchdog idea could commission a build; a geology walk
// could signpost the booking page or a message to the guide. The analysis that
// priced each one is `daydream-act-on-suggestions-2026-10-05.md` in the Drive's
// Architecture folder.
//
// ── The tiers, the same rule as "Do it for me" ─────────────────────────────
//
//   one tap   stays with him and can be taken back: put it on the backlog,
//             dig deeper (a research run), a Watch (Stop removes it).
//   guided    he reads what it will do first: the build brief before he
//             accepts it, the prototype before it starts, a Home Assistant
//             refresh, an email drafted in Gmail.
//   signpost  jkai prepares it and he does it: the booking page, a message
//             opened in WhatsApp or Mail with the text filled in.
//
// Nothing here sends, pays, books or cancels on his behalf. A phone number or
// address is only ever one that appears in the text of a source the note cites,
// found by CODE (`contactsIn`) — never written by a model.
//
// ── Cost is subscription quota, not cash ───────────────────────────────────
//
// Site LLM cash over the 30 days to 2026-10-05 was $0.76; almost everything
// runs on the ChatGPT subscription. So each offer says what it will use in
// those terms, measured where it could be (`FOLLOW_COST`).

import type { NoteReview } from '../think/notes';
import type { SourceLine } from '../think/explain';

export const FOLLOW_KINDS = ['research', 'promote', 'build', 'prototype', 'watch', 'message', 'home'] as const;
export type FollowKind = (typeof FOLLOW_KINDS)[number];

/** What each offer will use, in words — shown under its button. */
export const FOLLOW_COST: Record<FollowKind, string> = {
  research: 'A brief research run: about 9 web searches and under a penny of model calls (measured over 4 runs).',
  promote: 'No model call. It waits in the backlog as “Proposed” until you accept it.',
  build:
    'Drafting the brief is one model call. Once accepted it builds overnight, one a night — about 3.4M tokens of the ChatGPT subscription, the same as ~170 think cycles.',
  prototype: 'Starts now as a small preview build, capped at 1.5M tokens (~75 think cycles) and 45 minutes. Refused when the subscription is nearly used up.',
  watch: 'Setting it up is a few model calls, once. Then it checks on a schedule (every 6 hours unless you say otherwise).',
  message: 'One short model call to draft it. Nothing is sent — you send it yourself.',
  home: 'No model call. Asks Home Assistant to refresh the devices you pick.',
};

/** The prototype's hard ceiling — a one-page sketch, not an app. */
export const PROTOTYPE_BUDGET = Object.freeze({
  maxIterations: 6,
  maxTotalMinutes: 45,
  maxTokensPerHour: 1_500_000,
  maxTokensPerIteration: 600_000,
  activeMinutesPerHour: 45,
  maxIdleIterations: 2,
});

/** Refuse to start a prototype when the subscription's windows are this full. */
export const PROTOTYPE_QUOTA_CEILING = { fiveHourPct: 80, weeklyPct: 90 } as const;

/** The most Home Assistant devices one tap refreshes. */
export const MAX_HOME_REFRESH = 5;
/** The two Home Assistant services a note may ask for. Nothing else, ever:
 *  no unlock, no alarm, no heating set-point. Both are harmless if repeated. */
export const HOME_SERVICES = ['update_entity', 'reload_config_entry'] as const;

// ── What is stored on the note ─────────────────────────────────────────────
//
// One `proposed_actions` entry per follow-up, kind `follow:<kind>`. Every entry
// carries `done`, which is what makes the think loop's re-proposal keep the
// array rather than overwrite it (`thought-store.ts`).

export interface FollowEntry {
  kind: `follow:${FollowKind}`;
  label: string;
  payload: string;
  done: { at: string };
}

export interface ResearchData { sessionId: string }
export interface PromoteData { slug: string }
export interface BuildBrief {
  outcome: string;
  acceptance: string[];
  effort: string;
  risk: string;
  readiness: string;
  summary: string;
}
export interface BuildData {
  slug: string;
  /** The groomed brief as the backlog stores it — saved on accept. */
  grooming: Record<string, unknown>;
  brief: BuildBrief;
  title: string;
  detail: string;
  kind: string;
  priority: number;
  acceptedAt: string | null;
}
export interface PrototypeData { buildId: string; prompt: string }
export interface WatchData { workflowId: string; description: string; stoppedAt: string | null }
export interface MessageData {
  text: string;
  subject: string;
  /** Digits only, international, from a cited source. */
  phone: string | null;
  email: string | null;
  /** A Gmail draft, when he asked for one. */
  draft: { id: string; messageId: string; to: string; accountEmail: string; sentAt: string | null; discardedAt: string | null } | null;
}
export interface HomeData {
  /** What was unavailable when it looked. */
  found: Array<{ id: string; name: string }>;
  refreshed: string[];
  refreshedAt: string | null;
}

export function followEntry(kind: FollowKind, label: string, data: object, now: Date): FollowEntry {
  return { kind: `follow:${kind}`, label, payload: JSON.stringify(data), done: { at: now.toISOString() } };
}

/** Every follow-up stored on a note, by kind. Unreadable entries are skipped. */
export function readFollow(actions: unknown): Partial<Record<FollowKind, { at: string; data: Record<string, unknown> }>> {
  const out: Partial<Record<FollowKind, { at: string; data: Record<string, unknown> }>> = {};
  if (!Array.isArray(actions)) return out;
  for (const a of actions as Array<Partial<FollowEntry>>) {
    const kind = typeof a?.kind === 'string' && a.kind.startsWith('follow:') ? (a.kind.slice(7) as FollowKind) : null;
    if (!kind || !(FOLLOW_KINDS as readonly string[]).includes(kind) || typeof a.payload !== 'string') continue;
    try {
      const data = JSON.parse(a.payload) as Record<string, unknown>;
      if (data && typeof data === 'object') out[kind] = { at: String(a.done?.at ?? ''), data };
    } catch {
      /* not one this build can read */
    }
  }
  return out;
}

/** The note's actions with one follow-up replaced (or added). */
export function withFollow(actions: unknown, entry: FollowEntry): unknown[] {
  const rest = (Array.isArray(actions) ? actions : []).filter((a) => (a as { kind?: unknown })?.kind !== entry.kind);
  return [...rest, entry];
}

// ── Reading a note ─────────────────────────────────────────────────────────

/** Web addresses a note's sources point at, in the order cited: a fetched
 *  page's own address first, then any address inside a search result. */
export function webLinks(evidence: unknown, sources: readonly SourceLine[]): string[] {
  const out: string[] = [];
  const add = (u: string) => {
    const clean = u.replace(/[)\].,;"'\\]+$/, '');
    if (/^https?:\/\/[^\s/]+\.[^\s]+/.test(clean) && !out.includes(clean)) out.push(clean);
  };
  for (const s of sources) if (s.href) add(s.href);
  if (Array.isArray(evidence)) {
    for (const e of evidence as Array<{ note?: unknown }>) {
      if (typeof e?.note !== 'string') continue;
      for (const m of e.note.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) add(m[0]);
    }
  }
  return out.slice(0, 6);
}

/** What the note's sources said, as stored with it. */
export function evidenceText(evidence: unknown): string {
  if (!Array.isArray(evidence)) return '';
  return (evidence as Array<{ note?: unknown }>).map((e) => (typeof e?.note === 'string' ? e.note : '')).join('\n');
}

/**
 * Contact details that appear in a source's own text. A UK mobile or landline
 * (07…, 01…, 02…, +44…) and email addresses; anything else is left alone.
 * Phones come back as international digits ("447700900123").
 */
export function contactsIn(text: string): { phones: string[]; emails: string[] } {
  const phones: string[] = [];
  for (const m of text.matchAll(/(?<![\d+])(?:\+44\s?\(?0?\)?\s?|0)([12378]\d{2,3})[\s-]?(\d{3})[\s-]?(\d{3,4})(?!\d)/g)) {
    const digits = `44${m[1]}${m[2]}${m[3]}`;
    if (digits.length >= 12 && digits.length <= 13 && !phones.includes(digits)) phones.push(digits);
  }
  const emails: string[] = [];
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
    const e = m[0].toLowerCase().replace(/\.+$/, '');
    // Image names and the like ("logo@2x.png") are not people.
    if (/\.(png|jpe?g|gif|svg|webp)$/.test(e) || e.length > 120) continue;
    if (!emails.includes(e)) emails.push(e);
  }
  return { phones: phones.slice(0, 3), emails: emails.slice(0, 3) };
}

/** WhatsApp with the text filled in. No number: he chooses the contact. */
export function whatsappLink(text: string, phone: string | null): string {
  return `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const PROTOTYPE_WORDS = /\b(prototype|visual|visuali[sz]ation|animation|animated|toy|game|explainer|simulation|simulator|demo|physics|interactive|sketch|generative)\b/;
const WATCH_WORDS = /\b(watch|watchdog|monitor|alert|flag|unavailable|offline|blind spots?|coverage|keep an eye|drops?|spikes?|renews?|renewal|expires?|expiry|overdue|lapses?)\b/;
const HOME_FAULT_WORDS = /\b(unavailable|offline|not responding|blind spots?|coverage|dropped out|disconnected)\b/;
const CONTACT_WORDS = /\b(guide|organiser|organizer|host|book|booking|enquir\w*|ask|contact|message|places?|tickets?)\b/;
const BOOKING_WORDS = /\b(book|booking|tickets?|places?|register|sign up|reserve|listing|admission|entry)\b/;

export interface FollowInput {
  outcome: string;
  channel: string | null;
  title: string;
  summary: string;
  next: string | null;
  verdict: string | null;
  review: NoteReview | null;
  sources: readonly SourceLine[];
  evidence: unknown;
  build: { slug: string; status: string; accepted: boolean } | null;
  actions: unknown;
}

/** One offer as the card draws it. `state` is where it is; `href` is where
 *  the result lives once there is one. */
export interface FollowOffer {
  kind: FollowKind;
  state: 'offer' | 'drafted' | 'done' | 'stopped';
  label: string;
  cost: string;
  href?: string;
  /** When it was done — what "still running" is judged by. */
  at?: string;
}

export interface NoteFollow {
  /** The page to book on — a link, nothing more. */
  bookingUrl: string | null;
  offers: FollowOffer[];
  /** The groomed brief, once drafted, for him to read before accepting. */
  brief: (BuildBrief & { acceptedAt: string | null }) | null;
  /** The watch's description: drafted by code, his to edit before it starts. */
  watchDraft: string | null;
  message: {
    text: string;
    subject: string;
    whatsapp: string;
    mailto: string | null;
    email: string | null;
    draft: { to: string; status: 'drafted' | 'sent' | 'discarded'; gmailUrl: string } | null;
  } | null;
  home: { found: Array<{ id: string; name: string }>; refreshed: string[]; refreshedAt: string | null } | null;
}

/** Did he (or a double-check) back the note? Promoting a note to the backlog
 *  waits for this: the physics-prototype note that prompted this work was one
 *  he refuted, and the backlog already holds 305 abandoned ideas. */
export function noteBacked(verdict: string | null, review: NoteReview | null): boolean {
  if (review?.verdict === 'wrong') return false;
  return verdict === 'useful' || review?.verdict === 'holds';
}

export function noteTurnedDown(verdict: string | null, review: NoteReview | null): boolean {
  return review?.verdict === 'wrong' || verdict === 'not_useful' || verdict === 'never_kind';
}

/** The watch a note would start, in his words — code-built, editable. */
export function watchDraftFor(title: string, next: string | null): string {
  const step = (next ?? title).replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  return `Tell me when this needs attention: ${step}.`.slice(0, 400);
}

export function gmailComposeUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(messageId)}`;
}

/**
 * Which follow-ups a note gets, and where each is. A note he turned down, or a
 * double-check found wrong, gets none: there is nothing to take further.
 */
export function noteFollow(input: FollowInput): NoteFollow {
  const stored = readFollow(input.actions);
  const text = `${input.title}\n${input.summary}\n${input.next ?? ''}`.toLowerCase();
  const empty: NoteFollow = { bookingUrl: null, offers: [], brief: null, watchDraft: null, message: null, home: null };
  if (noteTurnedDown(input.verdict, input.review)) return empty;

  const links = webLinks(input.evidence, input.sources);
  const backed = noteBacked(input.verdict, input.review);
  const offers: FollowOffer[] = [];
  const out: NoteFollow = { ...empty };

  // ── Signpost: the booking page ──
  if (links.length && BOOKING_WORDS.test(text)) out.bookingUrl = links[0];

  // ── Dig deeper ──
  const research = stored.research?.data as Partial<ResearchData> | undefined;
  if (research?.sessionId) {
    offers.push({ kind: 'research', state: 'done', label: 'Research started', cost: FOLLOW_COST.research, href: `/research/${research.sessionId}`, at: stored.research?.at });
  } else if (links.length || input.channel === 'research' || input.outcome === 'research') {
    offers.push({ kind: 'research', state: 'offer', label: 'Dig deeper', cost: FOLLOW_COST.research });
  }

  // ── The backlog: promote, then accept ──
  const promoted = stored.promote?.data as Partial<PromoteData> | undefined;
  if (!input.build && input.outcome !== 'build' && backed && !promoted?.slug) {
    offers.push({ kind: 'promote', state: 'offer', label: 'Put it on the build backlog', cost: FOLLOW_COST.promote });
  }
  const build = stored.build?.data as Partial<BuildData> | undefined;
  const live = input.build && input.build.status === 'open';
  if (input.build?.accepted || build?.acceptedAt) {
    offers.push({ kind: 'build', state: 'done', label: 'Accepted — it builds overnight', cost: FOLLOW_COST.build, href: `/jkai/develop/backlog?item=${encodeURIComponent(input.build?.slug ?? build?.slug ?? '')}` });
  } else if (live) {
    offers.push({ kind: 'build', state: build?.brief && build.slug === input.build?.slug ? 'drafted' : 'offer', label: build?.brief ? 'Accept for build' : 'Draft the build brief', cost: FOLLOW_COST.build });
  }
  if (build?.brief && build.slug === input.build?.slug) out.brief = { ...build.brief, acceptedAt: build.acceptedAt ?? null };

  // ── A quick prototype ──
  const proto = stored.prototype?.data as Partial<PrototypeData> | undefined;
  if (proto?.buildId) {
    offers.push({ kind: 'prototype', state: 'done', label: 'Prototype started', cost: FOLLOW_COST.prototype, href: `/jkai/builds/${proto.buildId}`, at: stored.prototype?.at });
  } else if (PROTOTYPE_WORDS.test(text) && (input.outcome === 'build' || backed)) {
    offers.push({ kind: 'prototype', state: 'offer', label: 'Sketch a quick prototype', cost: FOLLOW_COST.prototype });
  }

  // ── A Watch instead of a build ──
  const watch = stored.watch?.data as Partial<WatchData> | undefined;
  if (watch?.workflowId) {
    offers.push({ kind: 'watch', state: watch.stoppedAt ? 'stopped' : 'done', label: watch.stoppedAt ? 'Watch stopped' : 'Watching', cost: FOLLOW_COST.watch, href: '/jkai/daydreams/watches' });
  } else if (input.channel && ['home', 'health', 'money', 'mail'].includes(input.channel) && WATCH_WORDS.test(text)) {
    offers.push({ kind: 'watch', state: 'offer', label: 'Watch for this instead', cost: FOLLOW_COST.watch });
    out.watchDraft = watchDraftFor(input.title, input.next);
  }

  // ── A message, sent by him ──
  const msg = stored.message?.data as Partial<MessageData> | undefined;
  const found = contactsIn(evidenceText(input.evidence));
  if (msg?.text) {
    const phone = msg.phone ?? null;
    const email = msg.email ?? null;
    const d = msg.draft ?? null;
    out.message = {
      text: msg.text,
      subject: msg.subject ?? input.title,
      whatsapp: whatsappLink(msg.text, phone),
      mailto: email ? mailtoLink(email, msg.subject ?? input.title, msg.text) : null,
      email,
      draft: d ? { to: d.to, status: d.sentAt ? 'sent' : d.discardedAt ? 'discarded' : 'drafted', gmailUrl: gmailComposeUrl(d.messageId) } : null,
    };
    offers.push({ kind: 'message', state: 'drafted', label: 'Message drafted', cost: FOLLOW_COST.message });
  } else if (found.phones.length || found.emails.length || (links.length && CONTACT_WORDS.test(text) && ['suggest', 'research'].includes(input.outcome))) {
    offers.push({ kind: 'message', state: 'offer', label: found.phones.length || found.emails.length ? 'Draft a message to them' : 'Draft an enquiry', cost: FOLLOW_COST.message });
  }

  // ── Home Assistant: refresh what dropped out ──
  const home = stored.home?.data as Partial<HomeData> | undefined;
  if (home?.found) {
    out.home = { found: home.found, refreshed: home.refreshed ?? [], refreshedAt: home.refreshedAt ?? null };
    offers.push({ kind: 'home', state: home.refreshedAt ? 'done' : 'drafted', label: home.refreshedAt ? 'Refreshed' : 'Choose what to refresh', cost: FOLLOW_COST.home });
  } else if (input.channel === 'home' && HOME_FAULT_WORDS.test(text)) {
    offers.push({ kind: 'home', state: 'offer', label: 'Check what has dropped out', cost: FOLLOW_COST.home });
  }

  out.offers = offers;
  return out;
}

/** How long a research run or a prototype counts as "in motion". */
export const FOLLOW_RUNNING_HOURS = 24;

/**
 * Where a note's follow-ups put it in the Inbox: `decide` when one is waiting
 * on him (a brief to read, a message drafted, devices to pick), `motion` when
 * something runs without him, else null.
 */
export function followStage(f: NoteFollow, now = Date.now()): 'decide' | 'motion' | null {
  if (f.offers.some((o) => o.state === 'drafted' && !(o.kind === 'message' && f.message?.draft && f.message.draft.status !== 'drafted'))) return 'decide';
  const recent = (o: FollowOffer) => !!o.at && now - Date.parse(o.at) < FOLLOW_RUNNING_HOURS * 3_600_000;
  if (f.offers.some((o) => o.state === 'done' && ((o.kind === 'watch') || ((o.kind === 'research' || o.kind === 'prototype') && recent(o))))) return 'motion';
  return null;
}

// ── Checks the server applies before acting ────────────────────────────────

/** A watch description he may have edited: plain words, bounded. */
export function cleanWatchDescription(raw: unknown): string | null {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return t.length >= 12 && t.length <= 400 ? t : null;
}

/** A Home Assistant entity id, and only one the check found. */
export function pickHomeEntities(chosen: unknown, found: ReadonlyArray<{ id: string }>): string[] {
  const allowed = new Set(found.map((f) => f.id));
  const ids = Array.isArray(chosen) ? chosen.filter((c): c is string => typeof c === 'string') : [];
  return [...new Set(ids)].filter((id) => allowed.has(id) && /^[a-z_]+\.[a-z0-9_]+$/.test(id)).slice(0, MAX_HOME_REFRESH);
}

/** Is this address one the note's sources actually show? Exact, lowercased. */
export function addressIsCited(address: string, sourceText: string): boolean {
  const a = address.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(a) && contactsIn(sourceText).emails.includes(a);
}

/** The groomed brief, as the card shows it. */
export function briefView(grooming: Record<string, unknown>): BuildBrief {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const readiness = grooming.readiness as { status?: unknown; reason?: unknown } | undefined;
  return {
    outcome: str(grooming.outcome),
    acceptance: list(grooming.acceptanceCriteria),
    effort: str(grooming.effort),
    risk: str(grooming.risk),
    readiness: readiness ? `${str(readiness.status)}${readiness.reason ? ` — ${str(readiness.reason)}` : ''}` : '',
    summary: str(grooming.assistantSummary),
  };
}

/** The prompt a prototype build is given: one page, no platform. */
export function prototypePrompt(title: string, summary: string, next: string | null): string {
  return [
    `Build a small, self-contained prototype: ${title}.`,
    '',
    summary.replace(/\s+/g, ' ').trim().slice(0, 1500),
    ...(next ? ['', `What it should show: ${next}`] : []),
    '',
    'Scope: ONE static page (HTML, CSS and JavaScript, no server, no database, no login, nothing from strangeramblings.com).',
    'Keep it to what can be judged in two minutes of play. It is a sketch to decide whether the idea is worth a real build.',
  ].join('\n').slice(0, 3800);
}

/** The message prompt: a short, first-person enquiry that says only what the
 *  note says. The recipient is never chosen by the model. */
export function messagePrompt(note: { title: string; summary: string; next: string | null }): string {
  return [
    "Write one short message John can send to the person or organiser behind this suggestion from his assistant.",
    `Title: ${note.title}`,
    `Note: ${note.summary.replace(/\s+/g, ' ').slice(0, 1500)}`,
    ...(note.next ? [`Suggested step: ${note.next}`] : []),
    '',
    'Rules: first person, polite, under 80 words, signed "John". Ask only what the note leaves open (availability, how to book, what to bring).',
    'Never invent a fact, a price, a date or a name the note does not give. No placeholders in brackets.',
    'Reply with JSON only: {"subject":"…","text":"…"}',
  ].join('\n');
}
