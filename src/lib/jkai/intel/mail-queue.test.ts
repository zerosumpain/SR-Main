// Making 2,781 held threads decidable.
//
// The clustering is the part that has to be right: if a sender cluster missed
// threads, an "admit all of linkedin.com" click would silently leave some
// behind, and the queue would never drain no matter how many decisions the
// owner made.
import { describe, it, expect } from 'vitest';
import { scoreThread, toQueueRow, clusterQueue, MIN_SUBJECT_CLUSTER, type QueueNote, type QueueRow } from './mail-queue';
import type { MailFacts } from './mail-facts';

const NOW = Date.UTC(2026, 7, 27);

const FACTS: MailFacts = {
  senderDomain: 'example.com',
  emailKind: 'correspondence',
  participantCount: 2,
  messageCount: 3,
  ownerReplied: false,
  twoWay: false,
  gmailImportant: false,
  hasAttachments: false,
  bodyChars: 800,
  ageDays: 10,
};

describe('scoreThread', () => {
  it('ranks a replied-to conversation above a marketing blast', () => {
    const conversation = scoreThread({ ...FACTS, ownerReplied: true, twoWay: true });
    const blast = scoreThread({ ...FACTS, emailKind: 'bulk', participantCount: 50 });
    expect(conversation.score).toBeGreaterThan(blast.score);
  });

  it('gives a reason for every point it awards', () => {
    const { score, reasons } = scoreThread({ ...FACTS, ownerReplied: true, gmailImportant: true });
    expect(score).toBeGreaterThan(0);
    expect(reasons).toContain('you replied');
    expect(reasons).toContain('Gmail marked it important');
  });

  it('penalises a thread with almost no text', () => {
    expect(scoreThread({ ...FACTS, bodyChars: 40 }).score).toBeLessThan(scoreThread(FACTS).score);
  });
});

function note(id: string, subject: string, domain: string, extra: Record<string, unknown> = {}): QueueNote {
  return {
    id,
    title: subject,
    rawContent: 'Messages: 1\n\n[1] · from a@b.com · to me@x.com\nhello there, this is a body',
    metadata: { gmailAccount: 'me@x.com', participants: ['a@b.com', 'me@x.com'], senderDomain: domain, emailKind: 'bulk', ...extra },
    observedAt: '2026-08-20T09:00:00Z',
    createdAt: '2026-08-20T09:00:00Z',
    graphState: 'pending',
  };
}

describe('toQueueRow', () => {
  it('marks a header-only stub as not yet captured', () => {
    const stub: QueueNote = {
      ...note('s', 'Supa Update', 'supabase.com', { structuralOnly: true }),
      rawContent: 'Email thread: Supa Update\nParticipants: welcome@supabase.com',
    };
    expect(toQueueRow(stub, NOW).captured).toBe(false);
  });

  it('links back into Gmail when the thread id is known', () => {
    const row = toQueueRow(note('a', 'Hello', 'b.com', { gmailThreadId: 'abc123' }), NOW);
    expect(row.gmailUrl).toContain('abc123');
  });

  it('has no link when the thread id was never recorded', () => {
    expect(toQueueRow(note('a', 'Hello', 'b.com'), NOW).gmailUrl).toBe(null);
  });
});

describe('clusterQueue', () => {
  const rows = (notes: QueueNote[]): QueueRow[] => notes.map((n) => toQueueRow(n, NOW));

  it('puts every thread from a sender into that sender cluster', () => {
    const list = rows([
      note('1', 'Order #204 shipped', 'shop.com'),
      note('2', 'Order #887 shipped', 'shop.com'),
      note('3', 'Something else entirely', 'shop.com'),
    ]);
    const clusters = clusterQueue(list);
    const sender = clusters.find((c) => c.key === 'sender:shop.com');
    expect(sender?.count).toBe(3);
    // The invariant that matters: admit-all on a sender must reach every thread
    // from that sender, or the queue never drains.
    expect(sender?.noteIds.sort()).toEqual(['1', '2', '3']);
  });

  it('offers a repeated subject as its own decision', () => {
    const list = rows([
      note('1', 'Order #204 shipped', 'shop.com'),
      note('2', 'Order #887 shipped', 'shop.com'),
      note('3', 'Order #991 shipped', 'shop.com'),
      note('4', 'Your receipt', 'shop.com'),
    ]);
    const clusters = clusterQueue(list);
    const subject = clusters.find((c) => c.kind === 'subject');
    expect(subject).toBeDefined();
    expect(subject?.count).toBe(MIN_SUBJECT_CLUSTER);
  });

  it('does not offer a subject cluster that is just the whole sender again', () => {
    const list = rows([
      note('1', 'Order #204 shipped', 'shop.com'),
      note('2', 'Order #887 shipped', 'shop.com'),
      note('3', 'Order #991 shipped', 'shop.com'),
    ]);
    const clusters = clusterQueue(list);
    expect(clusters.filter((c) => c.kind === 'subject')).toHaveLength(0);
    expect(clusters).toHaveLength(1);
  });

  it('does not split a sender on a subject only seen twice', () => {
    const list = rows([
      note('1', 'Order #204 shipped', 'shop.com'),
      note('2', 'Order #887 shipped', 'shop.com'),
      note('3', 'Newsletter August', 'shop.com'),
      note('4', 'Newsletter July', 'shop.com'),
    ]);
    expect(clusterQueue(list).filter((c) => c.kind === 'subject')).toHaveLength(0);
  });

  it('keeps senders apart', () => {
    const list = rows([note('1', 'Hello', 'a.com'), note('2', 'Hello', 'b.com')]);
    const clusters = clusterQueue(list);
    expect(clusters.map((c) => c.key).sort()).toEqual(['sender:a.com', 'sender:b.com']);
  });

  it('puts the biggest cluster first, because that is where a keystroke is worth most', () => {
    const list = rows([
      note('1', 'x', 'small.com'),
      ...Array.from({ length: 6 }, (_, i) => note(`b${i}`, `subject ${i}`, 'big.com')),
    ]);
    expect(clusterQueue(list)[0].domain).toBe('big.com');
  });

  it('counts what the owner replied to, so a cluster can say "look at this one"', () => {
    const replied = note('1', 'Tender', 'client.com', { emailKind: 'correspondence' });
    replied.rawContent = 'Messages: 2\n\n[1] · from a@client.com · to me@x.com\nhi\n\n[2] · from me@x.com · to a@client.com\nhello';
    const clusters = clusterQueue(rows([replied, note('2', 'Other', 'client.com')]));
    expect(clusters.find((c) => c.key === 'sender:client.com')?.repliedCount).toBe(1);
  });
});
