import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { getSetting } from '$lib/server/models/settings';
import {
  buildMailCandidates,
  findMailHits,
  MAIL_SCAN_DAYS,
  type MailRow,
  type SenderHistory,
} from '$lib/daydream/mail/scan';
import { classifyMail } from '$lib/daydream/mail/classify';
import { persistCandidates } from '$lib/daydream/thought-store';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import type { ActivityHandler } from '../types';

const NAME = 'daydream-mail';

interface MailScanConfig {
  /** How far back to read. Overlap is free — candidates dedupe on note id. */
  windowDays?: number;
  /** Ceiling on candidates offered in one run, before the ledger's own gates. */
  maxPerRun?: number;
}

const DEFAULTS: Required<MailScanConfig> = { windowDays: MAIL_SCAN_DAYS, maxPerRun: 8 };

/** How far back "has this sender written before?" looks. A year is enough to
 *  make a first-time correspondent meaningful without scanning the archive. */
const HISTORY_DAYS = 365;

/**
 * Read the mail nobody was reading.
 *
 * The offer index scans `emailKind = 'bulk'` for vouchers and penalises the
 * word "security" — correctly, for its purpose. The consequence was that the
 * 1,779 correspondence and notification emails on production were never looked
 * at by anything at all, which is where account recovery, payment failures and
 * official post live. Six account-security mails arrived from four senders on
 * 2026-08-27 and the engine said nothing.
 *
 * No model call. The classifier is regex over subject lines plus the sender,
 * and it was calibrated against the whole 2,906-email production corpus:
 * 39 security, 5 money, 3 official over ninety days, with no false positive
 * surviving the anti-signals. That is roughly one candidate every other day
 * BEFORE clustering, which is why this can be allowed to reach the delivery
 * path at all. Deliberately NOT in SPENDING_ACTIONS: it has no quota to
 * attribute.
 */
export const daydreamMail: ActivityHandler = {
  name: NAME,
  description:
    'Reads the half of the mailbox the offer index ignores — account security, money admin, official post, and senders writing for the first time — and offers what it finds to the thought ledger through the same scoring, mute and delivery gates as everything else. Clusters a burst into one thought. No LLM.',
  defaultCadenceSeconds: 3 * 3600,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as MailScanConfig) };

    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }

    try {
      const now = new Date(ctx.now);
      const windowStart = new Date(now.getTime() - cfg.windowDays * 86_400_000);
      const historyStart = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
      const observed = sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`;

      // ── The window under inspection ──
      const rows = await db
        .select({
          id: intelNotes.id,
          title: intelNotes.title,
          metadata: intelNotes.metadata,
          observedAt: intelNotes.observedAt,
          createdAt: intelNotes.createdAt,
        })
        .from(intelNotes)
        .where(and(eq(intelNotes.source, 'email'), gte(observed, windowStart)))
        .orderBy(observed)
        .limit(1500);

      const mails: MailRow[] = rows
        .filter((r) => (r.title ?? '').trim().length > 0)
        .map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            noteId: r.id,
            subject: r.title as string,
            senderDomain:
              typeof meta.senderDomain === 'string' ? meta.senderDomain.toLowerCase() : null,
            emailKind: typeof meta.emailKind === 'string' ? meta.emailKind : null,
            observedAt: r.observedAt ?? r.createdAt,
          };
        });

      // ── What the corpus knew BEFORE this window ──
      //
      // Strictly before, so a sender's own first message inside the window
      // cannot make itself familiar. Categories are recomputed rather than
      // stored: the classifier is pure and cheap, and a stored label would go
      // stale the moment the vocabulary changed.
      const priorRows = await db
        .select({
          title: intelNotes.title,
          metadata: intelNotes.metadata,
        })
        .from(intelNotes)
        .where(
          and(
            eq(intelNotes.source, 'email'),
            gte(observed, historyStart),
            lt(observed, windowStart),
          ),
        )
        .limit(6000);

      const history: SenderHistory = { known: new Set(), categoriesSeen: new Map() };
      for (const p of priorRows) {
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        const domain =
          typeof meta.senderDomain === 'string' ? meta.senderDomain.toLowerCase() : null;
        if (!domain) continue;
        history.known.add(domain);
        const c = classifyMail({
          subject: p.title,
          senderDomain: domain,
          emailKind: typeof meta.emailKind === 'string' ? meta.emailKind : null,
        });
        if (!c.category) continue;
        const set = history.categoriesSeen.get(domain) ?? new Set<string>();
        set.add(c.category);
        history.categoriesSeen.set(domain, set);
      }

      const hits = findMailHits(mails, history);
      // `now` is passed explicitly so the freshness gate is judged against the
      // engine's clock, which the heartbeat can override in a test run.
      const candidates = buildMailCandidates(hits, { now }).slice(0, cfg.maxPerRun);

      const byCategory: Record<string, number> = {};
      for (const h of hits) byCategory[h.category] = (byCategory[h.category] ?? 0) + 1;

      if (candidates.length === 0) {
        return {
          outcome: 'ok',
          // Reporting the nothing, deliberately: a scanner that only speaks up
          // when it finds something cannot be trusted when it is silent.
          summary: `${mails.length} emails read, nothing matched`,
          details: { read: mails.length, hits: 0, byCategory, known: history.known.size },
        };
      }

      const persisted = await persistCandidates(candidates, {
        runId: `mail-${now.getTime()}`,
        now,
      });

      const bursts = candidates.filter((c) => c.components.burst === 1).length;
      return {
        outcome: 'ok',
        summary:
          `${mails.length} read → ${hits.length} matched ` +
          `(${Object.entries(byCategory).map(([k, v]) => `${k} ${v}`).join(', ')}) ` +
          `→ ${candidates.length} candidates${bursts ? ` (${bursts} clustered)` : ''}: ` +
          `${persisted.created} new, ${persisted.updated} refreshed, ` +
          `${persisted.suppressed} below threshold, ${persisted.muted} muted`,
        details: { read: mails.length, hits: hits.length, byCategory, bursts, ...persisted },
      };
    } catch (err) {
      return { outcome: 'error', summary: errMsg(err) };
    }
  },
};
