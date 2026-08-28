import { describe, it, expect } from 'vitest';
import {
  CANDIDATE_MAX_AGE_DAYS,
  buildMailCandidates as buildAt,
  findMailHits,
  groupBursts,
  noveltyOf,
  rawScoreFor,
  BURST_MIN_MAILS,
  type MailRow,
  type SenderHistory,
} from './scan';

const NOBODY: SenderHistory = { known: new Set(), categoriesSeen: new Map() };

// The fixtures are dated August 2026, so every call pins `now` to just after
// them. Without this the freshness gate would silently empty every case and
// the tests would pass by asserting nothing.
const AFTER = new Date('2026-09-16T12:00:00Z');
const buildMailCandidates = (hits: Parameters<typeof buildAt>[0]) =>
  buildAt(hits, { now: AFTER, maxAgeDays: 3650 });

let seq = 0;
function row(subject: string, day: string, domain: string | null = null, kind = 'correspondence'): MailRow {
  // A per-row counter, not a subject prefix: two "Security alert" mails from
  // one sender on one day are two real notes, and a colliding fixture id hid
  // that the first time this was written.
  return {
    noteId: `note-${++seq}`,
    subject,
    senderDomain: domain,
    emailKind: kind,
    observedAt: new Date(`${day}T09:00:00Z`),
  };
}

describe('noveltyOf', () => {
  const known: SenderHistory = {
    known: new Set(['microsoft.com']),
    categoriesSeen: new Map([['microsoft.com', new Set(['money_admin'])]]),
  };

  it('calls a first-time correspondent new', () => {
    expect(noveltyOf(row('Security alert', '2026-08-27', 'newbank.com'), 'security', known)).toBe('new_sender');
  });

  it('does not call a first-time BULK sender new', () => {
    // New marketing domains appear every week and none of them is a finding.
    expect(
      noveltyOf(row('Security alert', '2026-08-27', 'newshop.com', 'bulk'), 'security', known),
    ).toBeNull();
  });

  it('notices a known sender writing about something new', () => {
    expect(
      noveltyOf(row('Security alert', '2026-08-27', 'microsoft.com'), 'security', known),
    ).toBe('new_category_for_sender');
  });

  it('says nothing about a known sender doing a known thing', () => {
    expect(
      noveltyOf(row('Your payment failed', '2026-08-27', 'microsoft.com'), 'money_admin', known),
    ).toBeNull();
  });

  it('has no opinion without a sender domain', () => {
    expect(noveltyOf(row('Security alert', '2026-08-27', null), 'security', known)).toBeNull();
  });
});

describe('rawScoreFor', () => {
  it('never reaches certainty — it is a rule over a subject line', () => {
    expect(rawScoreFor(99, 'new_sender')).toBeLessThan(1);
  });

  it('ranks a stronger match higher', () => {
    expect(rawScoreFor(10, null)).toBeGreaterThan(rawScoreFor(4, null));
  });

  it('adds a little for novelty', () => {
    expect(rawScoreFor(6, 'new_sender')).toBeGreaterThan(rawScoreFor(6, null));
  });
});

describe('groupBursts', () => {
  it('measures the window from the first member, not the last', () => {
    // Otherwise a steady trickle chains into one burst that never closes.
    const hits = findMailHits(
      [
        row('Security alert', '2026-08-01', 'a.com'),
        row('Security alert', '2026-08-02', 'b.com'),
        row('Security alert', '2026-08-03', 'c.com'),
        row('Security alert', '2026-08-04', 'd.com'),
      ],
      NOBODY,
    );
    const groups = groupBursts(hits);
    expect(groups.length).toBeGreaterThan(1);
  });

  it('keeps categories apart', () => {
    const hits = findMailHits(
      [
        row('Security alert', '2026-08-27', 'a.com'),
        row('Your payment failed', '2026-08-27', 'b.com'),
      ],
      NOBODY,
    );
    expect(groupBursts(hits)).toHaveLength(2);
  });
});

describe('the 2026-08-27 cluster', () => {
  // The real thing: six account-security mails from four senders in one day,
  // and the engine said nothing.
  const cluster = [
    row('Regarding Your Microsoft Account', '2026-08-27', 'microsoft.com'),
    row('Personal Microsoft account security code', '2026-08-27', 'microsoft.com'),
    row('Your account recovery request', '2026-08-27', 'live.com'),
    row('Unrecognized device signed in to your OpenRouter account', '2026-08-27', 'openrouter.ai'),
    row('Security alert', '2026-08-27', 'gmail.com'),
    row('Security alert for a second address', '2026-08-27', 'gmail.com'),
  ];

  it('becomes ONE thought, not six', () => {
    const candidates = buildMailCandidates(findMailHits(cluster, NOBODY));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe('mail_security');
    expect(candidates[0].components.burst).toBe(1);
  });

  it('counts the mails and the distinct senders', () => {
    const [c] = buildMailCandidates(findMailHits(cluster, NOBODY));
    expect(c.components.mails).toBe(6);
    expect(c.components.senders).toBe(4);
    expect(c.title).toContain('6 account-security emails from 4 senders');
  });

  it('carries every message as evidence, so the card can drill through', () => {
    const [c] = buildMailCandidates(findMailHits(cluster, NOBODY));
    expect(c.evidence).toHaveLength(6);
    expect(c.evidence.every((e) => e.kind === 'email')).toBe(true);
    expect(new Set(c.evidence.map((e) => e.id)).size).toBe(6);
  });

  it('explains itself without a model having run', () => {
    const [c] = buildMailCandidates(findMailHits(cluster, NOBODY));
    expect(c.explanation).toContain('6 emails matched');
    expect(c.explanation).toContain('Microsoft');
    expect(c.explanation.length).toBeGreaterThan(80);
  });

  it('scores the cluster above any single member', () => {
    const [burst] = buildMailCandidates(findMailHits(cluster, NOBODY));
    const [single] = buildMailCandidates(findMailHits([cluster[2]], NOBODY));
    expect(burst.rawScore).toBeGreaterThan(single.rawScore);
  });
});

describe('one sender retrying is not a pattern', () => {
  // SecondSim sent the same payment-failure notice on four days in August.
  // That is a retry loop, and calling it a cluster would be a lie about how
  // many things went wrong.
  const retries = [
    row('Action Required: Your SecondSim Subscription Payment Failed', '2026-08-05', 'secondsim.co.uk'),
    row('Action Required: Your SecondSim Subscription Payment Failed', '2026-08-05', 'secondsim.co.uk'),
    row('Action Required: Your SecondSim Subscription Payment Failed', '2026-08-06', 'secondsim.co.uk'),
  ];

  it('does not form a burst from a single sender', () => {
    const candidates = buildMailCandidates(findMailHits(retries, NOBODY));
    expect(candidates.every((c) => c.components.burst === undefined)).toBe(true);
    expect(candidates).toHaveLength(retries.length);
  });

  it('gives each its own dedupe key so re-scanning does not duplicate them', () => {
    const candidates = buildMailCandidates(findMailHits(retries, NOBODY));
    expect(new Set(candidates.map((c) => c.dedupeKey)).size).toBe(candidates.length);
    expect(candidates[0].dedupeKey).toMatch(/^mail:/);
  });
});

describe('a burst dedupe key is stable as the burst grows', () => {
  it('anchors on the first mail, so a later arrival updates rather than spawns', () => {
    const first = buildMailCandidates(
      findMailHits(
        [
          row('Security alert', '2026-08-27', 'a.com'),
          row('Your account recovery request', '2026-08-27', 'b.com'),
          row('New sign-in to your account', '2026-08-27', 'c.com'),
        ],
        NOBODY,
      ),
    );
    const grown = buildMailCandidates(
      findMailHits(
        [
          row('Security alert', '2026-08-27', 'a.com'),
          row('Your account recovery request', '2026-08-27', 'b.com'),
          row('New sign-in to your account', '2026-08-27', 'c.com'),
          row('Password reset requested', '2026-08-28', 'd.com'),
        ],
        NOBODY,
      ),
    );
    expect(grown[0].dedupeKey).toBe(first[0].dedupeKey);
    expect(grown[0].components.mails).toBe(4);
  });
});

describe('quiet weeks', () => {
  it('produces nothing at all from ordinary mail', () => {
    const ordinary = [
      row("Time's Running Out: Use Code Freedel!", '2026-08-23', 'brooktaverner.co.uk', 'bulk'),
      row('This week in Claude Code: /design and more', '2026-08-22', 'anthropic.com', 'bulk'),
      row('[zerosumpain/SR-Main] PR run failed: CI', '2026-08-25', 'noreply.github.com', 'notification'),
    ];
    expect(buildMailCandidates(findMailHits(ordinary, NOBODY))).toHaveLength(0);
  });

  it('needs BURST_MIN_MAILS before it will call anything a cluster', () => {
    const two = [
      row('Security alert', '2026-08-27', 'a.com'),
      row('Your account recovery request', '2026-08-27', 'b.com'),
    ];
    expect(BURST_MIN_MAILS).toBeGreaterThan(2);
    const candidates = buildMailCandidates(findMailHits(two, NOBODY));
    expect(candidates).toHaveLength(2);
  });
});

describe('the freshness gate', () => {
  // The scan reads a fortnight so a burst can be recognised as one; it speaks
  // about a much shorter window, because an alert nobody can act on any more
  // is not worth an interruption.
  const now = new Date('2026-08-28T12:00:00Z');

  it('offers a candidate for mail that arrived today', () => {
    const fresh = findMailHits([row('Your account recovery request', '2026-08-28', 'live.com')], NOBODY);
    expect(buildAt(fresh, { now })).toHaveLength(1);
  });

  it('says nothing about a security alert from a fortnight ago', () => {
    const stale = findMailHits([row('Your account recovery request', '2026-08-10', 'live.com')], NOBODY);
    expect(buildAt(stale, { now })).toHaveLength(0);
  });

  it('judges a burst on its NEWEST member, so a live incident stays live', () => {
    // Anchored 48h back — right at the edge of BURST_WINDOW_HOURS — and still
    // arriving today. A wider spread than that is correctly two incidents,
    // not one, which is what the burst window is for.
    const running = findMailHits(
      [
        row('Security alert', '2026-08-25', 'a.com'),
        row('Your account recovery request', '2026-08-26', 'b.com'),
        row('New sign-in to your account', '2026-08-27', 'c.com'),
      ],
      NOBODY,
    );
    const built = buildAt(running, { now });
    expect(built).toHaveLength(1);
    expect(built[0].components.burst).toBe(1);
  });

  it('has a gate measured in days, not weeks', () => {
    expect(CANDIDATE_MAX_AGE_DAYS).toBeLessThanOrEqual(7);
  });
});

describe('counting senders', () => {
  // Only 1,837 of 2,906 production email notes carry a senderDomain. The first
  // live run said "8 emails from 3 senders" while the burst gate had counted
  // six, because the display collapsed every anonymous mail into one
  // "unidentified sender" and the gate had not. The two must agree.
  const anonymousCluster = [
    row('Security alert', '2026-08-27', null),
    row('Your account recovery request', '2026-08-27', null),
    row('New sign-in to your account', '2026-08-27', null),
    row('Unrecognized device signed in to your account', '2026-08-27', 'microsoft.com'),
  ];

  it('does not collapse unidentified senders into one', () => {
    const [c] = buildMailCandidates(findMailHits(anonymousCluster, NOBODY));
    expect(c.components.senders).toBe(4);
    expect(c.title).toContain('4 senders');
  });

  it('says how many named no sender, rather than implying they were all known', () => {
    const [c] = buildMailCandidates(findMailHits(anonymousCluster, NOBODY));
    expect(c.components.unnamedSenders).toBe(3);
    expect(c.explanation).toContain('Microsoft');
    expect(c.explanation).toContain('3 that named no sender');
  });

  it('is honest when nothing in the group named a sender at all', () => {
    const [c] = buildMailCandidates(findMailHits(anonymousCluster.slice(0, 3), NOBODY));
    expect(c.explanation).toContain('none of which named a sender');
  });

  it('agrees with the burst gate', () => {
    // If the display count were lower than BURST_MIN_SENDERS, a card would
    // claim fewer senders than the rule that admitted it required.
    const [c] = buildMailCandidates(findMailHits(anonymousCluster, NOBODY));
    expect(Number(c.components.senders)).toBeGreaterThanOrEqual(2);
  });
});
