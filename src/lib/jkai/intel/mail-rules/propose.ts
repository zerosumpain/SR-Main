// Asking a model what the owner's decisions have in common.
//
// The learning loop, and the only place a model is involved in it. What it gets
// to see is deliberately narrow: the fact vocabulary, aggregate statistics
// about the queue, and — crucially — a SUMMARY of what the owner admitted and
// rejected, never the mail itself. A proposer that needed to read the mailbox
// to suggest a rule would be a proposer that had been handed the mailbox, and
// there is no reason for it: a rule is a statement about the SHAPE of a thread,
// not about any particular one.
//
// Everything it returns is data, validated by ../mail-rules/spec, backtested by
// ./backtest, and stored as `proposed`. Nothing it can say activates anything.
//
// Same shape as $lib/daydream/rules/propose — the shipped precedent the owner
// has already approved for exactly this pattern.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { getLLMClient } from '$lib/llm/client';
import { resolveExtractionModel } from '$lib/server/models/workload-settings';
import { MAIL_FACT_KEYS, STRING_MAIL_FACTS, BOOLEAN_MAIL_FACTS } from '../mail-facts';
import { ownerDecisions } from '../mail-decisions';
import { listMailRules } from './store';
import { MAX_ADMIT_SHARE, MAX_ADMITS_PER_WEEK } from './backtest';
import { withActivity } from '$lib/context/activity';

export interface ProposalBatch {
  proposals: Array<Record<string, unknown>>;
  tokens: number;
  error: string | null;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * What the proposer is allowed to know. Aggregates and one-line summaries only.
 *
 * The admitted/rejected breakdowns are counts BY FACT rather than lists of
 * threads: "you admitted 34 threads, 31 of which you had replied to" is
 * everything a rule-writer needs and gives away nothing about who wrote to whom
 * or what about.
 */
export async function gatherProposalContext(): Promise<string> {
  const decisions = await ownerDecisions();
  const admits = decisions.filter((d) => d.decision === 'admit');
  const rejects = decisions.filter((d) => d.decision === 'reject');

  const share = (list: typeof decisions, predicate: (d: (typeof decisions)[number]) => boolean) =>
    list.length ? `${list.filter(predicate).length}/${list.length}` : '0/0';

  const [queue] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'pending')::int`,
      admitted: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'admitted')::int`,
      rejected: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'rejected')::int`,
    })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'));

  const kinds = await db
    .select({ kind: sql<string>`coalesce(${intelNotes.metadata}->>'emailKind', 'unknown')`, n: sql<number>`count(*)::int` })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')))
    .groupBy(sql`coalesce(${intelNotes.metadata}->>'emailKind', 'unknown')`);

  // Top pending senders by volume — a domain name is not private in the way a
  // thread is, and "linkedin.com, 56 threads" is exactly the shape of fact a
  // useful rule is made of.
  const senders = await db
    .select({ domain: sql<string>`coalesce(${intelNotes.metadata}->>'senderDomain', 'unknown')`, n: sql<number>`count(*)::int` })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')))
    .groupBy(sql`coalesce(${intelNotes.metadata}->>'senderDomain', 'unknown')`)
    .orderBy(sql`count(*) desc`)
    .limit(25);

  // How the pending queue is distributed across the topical axis. Without this
  // the proposer is guessing at thresholds: "graphEntityHits >= 2" is a narrow
  // rule or the whole mailbox depending on numbers only the scorer knows.
  const [relevance] = await db
    .select({
      scored: sql<number>`count(*) filter (where coalesce(${intelNotes.metadata}, '{}'::jsonb) ? 'graphRelevance')::int`,
      anyHit: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'hits')::int > 0)::int`,
      twoPlus: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'hits')::int >= 2)::int`,
      watched: sql<number>`count(*) filter (where (${intelNotes.metadata}->'graphRelevance'->>'topWeight')::int >= 3)::int`,
    })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')));

  const existing = await listMailRules();
  const numeric = MAIL_FACT_KEYS.filter((f) => !STRING_MAIL_FACTS.has(f) && !BOOLEAN_MAIL_FACTS.has(f));

  return [
    'FACTS YOU MAY USE (nothing else exists):',
    `  numeric: ${numeric.join(', ')}`,
    `  string:  ${[...STRING_MAIL_FACTS].join(', ')}  (emailKind is one of: correspondence, notification, bulk)`,
    `  boolean: ${[...BOOLEAN_MAIL_FACTS].join(', ')}`,
    '',
    'THE QUEUE:',
    `  ${queue?.pending ?? 0} pending, ${queue?.admitted ?? 0} admitted, ${queue?.rejected ?? 0} rejected`,
    `  pending by kind: ${kinds.map((k) => `${k.kind} ${k.n}`).join(', ') || 'none'}`,
    '',
    'TOP PENDING SENDERS:',
    ...(senders.length ? senders.map((s) => `  ${s.domain}: ${s.n}`) : ['  none']),
    '',
    'RELATION TO THE GRAPH (pending threads):',
    `  scored: ${relevance?.scored ?? 0}  (unscored threads report 0 for every graph* fact)`,
    `  naming at least one anchored entity: ${relevance?.anyHit ?? 0}`,
    `  naming two or more: ${relevance?.twoPlus ?? 0}`,
    `  naming something watched or in a dossier: ${relevance?.watched ?? 0}`,
    '',
    "WHAT THE OWNER HAS DECIDED (their own decisions only):",
    `  admitted ${admits.length}:`,
    `    replied to: ${share(admits, (d) => d.facts.ownerReplied)}`,
    `    two-way: ${share(admits, (d) => d.facts.twoWay)}`,
    `    Gmail important: ${share(admits, (d) => d.facts.gmailImportant)}`,
    `    correspondence: ${share(admits, (d) => d.facts.emailKind === 'correspondence')}`,
    `    with attachments: ${share(admits, (d) => d.facts.hasAttachments)}`,
    `  rejected ${rejects.length}:`,
    `    bulk: ${share(rejects, (d) => d.facts.emailKind === 'bulk')}`,
    `    notification: ${share(rejects, (d) => d.facts.emailKind === 'notification')}`,
    `    replied to: ${share(rejects, (d) => d.facts.ownerReplied)}`,
    `    Gmail important: ${share(rejects, (d) => d.facts.gmailImportant)}`,
    '',
    'RULES THAT ALREADY EXIST (do not repeat or contradict these):',
    ...(existing.length
      ? existing.map((r) => `  ${r.key} [${r.status}] ${r.action}: ${r.label}`)
      : ['  none']),
  ].join('\n');
}

const SYSTEM = `You decide which email threads are worth putting into a personal knowledge graph, by writing RULES.

Context: this graph was previously fed the owner's entire mailbox and became useless — 67% of its entities came from
marketing email, and the most common relationship in it was "offers". Every thread is now held until a rule or the
owner admits it. Your job is to notice what the owner's own decisions have in common and express it as a rule.

A rule is DATA, not code. Output JSON matching this shape exactly:

{
  "key": "lowercase-kebab-identifier",
  "label": "one line the owner will read before approving",
  "action": "admit" | "reject",
  "condition": <condition>,
  "rationale": "why you are proposing this, in plain words"
}

A <condition> is one of:
  {"all": [<condition>, ...]}
  {"any": [<condition>, ...]}
  {"not": <condition>}
  {"fact": "<fact name>", "op": "lt"|"lte"|"gt"|"gte"|"eq"|"neq", "value": <number|string|boolean>}

Hard constraints — a proposal breaking any of these is discarded unread:
- Only facts from the list given. There is nothing else. You cannot read a subject line, a body, an address or a document.
- The graph* facts are the one topical signal you have. They are scored against entities the graph knows from sources
  OTHER than email, so admitted mail can never inflate them. graphTopHitWeight is 3 when the thread names something
  watched or in a dossier, 2 when well corroborated, 1 when merely known, 0 when nothing. Prefer WEIGHT over count:
  many hits of unimportant entities is a mailshot, two hits including a watched one is a subject.
- String and boolean facts take only eq/neq.
- At most 16 conditions, nesting at most 4 deep, at most 8 branches per all/any.
- Never set "status". Rules are activated by the owner, never by you.

What makes a GOOD rule:
- It is NARROW. An admit rule matching more than ${Math.round(MAX_ADMIT_SHARE * 100)}% of the mailbox, or admitting more than
  ${MAX_ADMITS_PER_WEEK} threads a week, is rejected automatically.
- It describes either the SHAPE of a thread (who wrote, how often, how long) or its RELATION TO THE GRAPH (the
  graph* facts). Those are the only two axes that exist. You still cannot see what a thread is actually about.
- A reject rule for a specific bulk sender is often more useful than another admit rule: it drains the queue
  without putting anything into the graph.
- It degrades safely: an unknown fact makes its condition false, so never depend on something being absent.

Output ONLY a JSON array of up to 3 rule objects. No prose, no code fence. If nothing is worth proposing, output [].`;

/**
 * Ask for a batch of proposals.
 *
 * Returns raw objects. Validation, backtesting and the auto-refusal gates all
 * run in the caller (see ../../routes/api/jkai/intel/mail/rules), because a
 * proposer that graded its own output would be the thing this design is
 * organised to avoid.
 */
export async function proposeMailRules(maxProposals = 3): Promise<ProposalBatch> {
  const result: ProposalBatch = { proposals: [], tokens: 0, error: null };
  try {
    const decisions = await ownerDecisions();
    if (decisions.length < 10) {
      result.error =
        `Only ${decisions.length} decisions so far — decide on a few more threads and there will be a pattern to find.`;
      return result;
    }

    const context = await gatherProposalContext();
    const { client, model } = await getLLMClient(await resolveExtractionModel());

    // Tagged `extraction`, the role whose model it resolves above.
    const res = await withActivity('extraction', () =>
      client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `${context}\n\nPropose at most ${maxProposals} rules. Prefer narrow rules, and prefer a reject rule for a noisy sender over a broad admit rule.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 1600,
      }),
    );
    result.tokens = (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);

    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    if (!raw || raw === '[]') return result;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      result.error = 'The proposer did not return a list of rules.';
      return result;
    }
    for (const item of parsed.slice(0, maxProposals)) {
      if (item && typeof item === 'object') result.proposals.push(item as Record<string, unknown>);
    }
  } catch (err) {
    result.error = errMsg(err);
  }
  return result;
}
