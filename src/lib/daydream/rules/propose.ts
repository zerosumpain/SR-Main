// src/lib/daydream/rules/propose.ts
//
// The model half of the mesh: looking at what daydreaming has actually done and
// proposing what should change about it.
//
// Three moves, and the brief asks for all three:
//   • propose a NEW rule
//   • TWEAK an existing one (usually a threshold that fires too often or never)
//   • DEPRECATE one its own record condemns
//
// What it gets to see is deliberately narrow: the fact vocabulary, the current
// rules with their outcomes, and aggregate statistics about the trail. Not the
// trail itself, not a single coordinate, not an email. A proposer that needs to
// read the owner's movements to suggest a rule is a proposer that has been
// handed the owner's movements, and there is no reason for it — a rule is a
// statement about the SHAPE of a situation, not about any instance of one.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { daydreamPlaces, daydreamThoughts, daydreamTrail } from '$lib/db/schema';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDaydreamModel } from '../compose';
import { errMsg } from '../types';
import { FACT_KEYS, STRING_FACTS, BOOLEAN_FACTS } from './spec';
import { listActiveRules, retirementCandidates } from './store';

export interface ProposalBatch {
  proposals: Array<{ proposalKind: 'new' | 'tweak' | 'deprecate'; spec: unknown; supersedesKind?: string }>;
  tokens: number;
  error: string | null;
}

/** What the proposer is allowed to know. Aggregates only. */
export async function gatherProposalContext(): Promise<string> {
  const [placeStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      named: sql<number>`count(*) filter (where ${daydreamPlaces.label} is not null)::int`,
      kinds: sql<string>`coalesce(string_agg(distinct ${daydreamPlaces.kind}, ','), '')`,
    })
    .from(daydreamPlaces);

  const [trailStats] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      days: sql<number>`coalesce(round(extract(epoch from (now() - min(${daydreamTrail.ts}))) / 86400)::int, 0)`,
    })
    .from(daydreamTrail);

  const kindStats = await db
    .select({
      kind: daydreamThoughts.kind,
      fired: sql<number>`count(*)::int`,
      useful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'useful')::int`,
      notUseful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'not_useful')::int`,
      suppressed: sql<number>`count(*) filter (where ${daydreamThoughts.status} = 'suppressed')::int`,
    })
    .from(daydreamThoughts)
    .groupBy(daydreamThoughts.kind);

  const active = await listActiveRules();
  const retire = await retirementCandidates();

  const numericFacts = FACT_KEYS.filter((f) => !STRING_FACTS.has(f) && !BOOLEAN_FACTS.has(f));

  return [
    'FACTS YOU MAY USE (nothing else exists):',
    `  numeric: ${numericFacts.join(', ')}`,
    `  string:  ${[...STRING_FACTS].join(', ')}`,
    `  boolean: ${[...BOOLEAN_FACTS].join(', ')}`,
    '',
    'CURRENT STATE:',
    `  trail: ${trailStats?.rows ?? 0} points over ${trailStats?.days ?? 0} days`,
    `  places: ${placeStats?.total ?? 0} total, ${placeStats?.named ?? 0} named; kinds seen: ${placeStats?.kinds || 'none'}`,
    '',
    'WHAT EACH THOUGHT KIND HAS DONE:',
    ...(kindStats.length
      ? kindStats.map(
          (k) =>
            `  ${k.kind}: fired ${k.fired}, useful ${k.useful}, not useful ${k.notUseful}, held back ${k.suppressed}`,
        )
      : ['  (nothing has fired yet)']),
    '',
    'RULES YOU HAVE ALREADY PROPOSED AND HE APPROVED:',
    ...(active.length
      ? active.map((r) => `  ${r.kind}: ${JSON.stringify(r.spec.when)} — fired ${r.firedCount}, useful ${r.usefulCount}, not useful ${r.notUsefulCount}`)
      : ['  (none yet)']),
    '',
    'RULES HIS OWN FEEDBACK CONDEMNS (propose deprecating these):',
    ...(retire.length ? retire.map((r) => `  ${r.kind}`) : ['  (none)']),
  ].join('\n');
}

const SYSTEM = `You maintain the rule set for a personal assistant that notices things about John and occasionally tells him.

A rule is DATA, not code. You output JSON matching this shape exactly:

{
  "kind": "lower_snake_case_identifier",
  "description": "one line, what it notices",
  "title": "notification title, may use {{place}}",
  "explanation": "why it fired, may use {{place}} and any fact name in {{braces}}",
  "when": <condition>,
  "base": 0.0-1.0,
  "terms": [{"fact": "<numeric fact>", "from": n, "to": n, "weight": 0.0-1.0}],
  "minTrailDays": n,
  "dedupe": "day" | "place" | "place-day" | "week",
  "rationale": "why you are proposing this, for John to read"
}

A <condition> is one of:
  {"all": [<condition>, ...]}
  {"any": [<condition>, ...]}
  {"not": <condition>}
  {"fact": "<fact name>", "op": "lt"|"lte"|"gt"|"gte"|"eq"|"neq", "value": <number|string|boolean>}

Hard constraints — a proposal breaking any of these is discarded unread:
- Only facts from the list given. There is nothing else. You cannot read the trail, an email, a coordinate or a memory.
- String and boolean facts take only eq/neq.
- base + sum(term weights) must be <= 1.
- At most 12 conditions, nesting at most 4 deep, at most 5 score terms.
- A fact that is unknown at run time makes its condition FALSE. Never write a rule that depends on something being absent.

What makes a GOOD rule:
- It fires a handful of times a week, not daily. Anything firing more than ~14 times a week is rejected automatically.
- It says something John could not have worked out by looking at his own phone.
- It is about a SHAPE of situation, not one specific moment.
- It degrades safely: if half its facts are unknown, it simply does not fire.

Output ONLY a JSON array of up to 3 objects, each: {"proposalKind": "new"|"tweak"|"deprecate", "supersedesKind": "<kind>"|null, "spec": {...}}
For a deprecate, "spec" may be the existing rule's spec unchanged — the rationale is what matters.
No prose, no code fence. If nothing is worth proposing, output [].`;

/** Ask for a batch. Returns raw proposals; the gates run in store.ts. */
export async function proposeRules(maxProposals = 3): Promise<ProposalBatch> {
  const result: ProposalBatch = { proposals: [], tokens: 0, error: null };
  try {
    const context = await gatherProposalContext();
    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);

    const res = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `${context}\n\nPropose at most ${maxProposals} changes. Prefer tweaking or deprecating what exists over adding more.`,
        },
      ],
      temperature: 0.4,
      max_tokens: 1600,
    });
    result.tokens = (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);

    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    if (!raw || raw === '[]') return result;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      result.error = 'proposer did not return an array';
      return result;
    }

    for (const item of parsed.slice(0, maxProposals)) {
      const o = item as Record<string, unknown>;
      const kind = o.proposalKind;
      if (kind !== 'new' && kind !== 'tweak' && kind !== 'deprecate') continue;
      result.proposals.push({
        proposalKind: kind,
        spec: o.spec,
        supersedesKind: typeof o.supersedesKind === 'string' ? o.supersedesKind : undefined,
      });
    }
  } catch (err) {
    result.error = errMsg(err);
  }
  return result;
}
