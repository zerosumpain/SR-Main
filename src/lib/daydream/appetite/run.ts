// src/lib/daydream/appetite/run.ts
//
// One appetite cycle: read what the site can and cannot do, ask what it should
// be able to do, audit the answer, write the survivors to the ledger, and
// offer the strongest as ordinary thoughts.
//
// ── What this is for ────────────────────────────────────────────────────────
//
// Everything else in this engine improves the machine that exists. The
// toolsmith closes gaps the machine reported; `optimise.ts` makes an answer
// cost fewer calls. Neither can ever propose a faculty, and the owner's brief
// (2026-09-04) is that new capability should outrank efficiency — "actively
// encouraging it to think about site capability enhancements over efficiency
// tweaks". This is where that thinking happens.
//
// ── The contract, unchanged from ponder ─────────────────────────────────────
//
// The model phrases; code decides. Every proposal must cite lines that were
// actually in the pack (`validateProposals`), the score is arithmetic over
// named inputs (`scoreCapability`), and the drop list goes on the pulse. The
// stage cannot write a tool, dispatch a build, or spend a penny beyond its one
// completion — self-improvement drains the ledger, and does it under its own
// switches.

import { getLLMClient } from '$lib/llm/client';
import { resolveDaydreamModel } from '../compose';
import { persistCandidates, type PersistResult } from '../thought-store';
import { errMsg } from '../types';
import { assembleAppetitePack, renderAppetitePack } from './pack';
import { capabilityToCandidate } from './bridge';
import { listCapabilities, upsertCapability } from './store';
import { CAPABILITY_KINDS, type CapabilityProposal, validateProposals } from './spec';

export interface AppetiteResult {
  /** Lines of evidence assembled, by section. */
  packSizes: Record<string, number>;
  packFacts: number;
  proposed: number;
  admitted: number;
  created: number;
  refreshed: number;
  /** Why each rejected proposal was rejected. The fabrication meter. */
  dropped: string[];
  bridged: PersistResult & { offered: number };
  tokens: { prompt: number; completion: number };
  error: string | null;
}

const EMPTY_PERSIST: PersistResult = {
  created: 0,
  updated: 0,
  suppressed: 0,
  muted: 0,
  alreadyRefuted: 0,
  protectedSkipped: 0,
  merged: 0,
  createdKeys: [],
};

/** How many proposals one cycle may admit, before the effort dial. */
export const DEFAULT_MAX_LEADS = 3;

function systemPrompt(maxLeads: number): string {
  return [
    'You are the capability planner for a single owner\'s personal site — a SvelteKit app with a chat assistant',
    '(jkai), a knowledge graph, a workflow canvas, an autonomous builder, and a background "daydreaming" engine',
    'that watches the owner\'s data and tells him things worth knowing.',
    '',
    'You are given an evidence pack: what the owner has been asking about, what the site can already reach, where',
    'the engine came up short, and what has already been proposed. Your job is to name capabilities the site does',
    'NOT have and should.',
    '',
    'Rules:',
    `- Propose at most ${maxLeads}. Fewer good ones beats a full list.`,
    `- Every proposal MUST cite at least one [key] from the pack, verbatim, in "cites". A proposal citing nothing`,
    '  in the pack is discarded unread — do not invent keys.',
    '- NEVER propose anything the pack says already exists. A duplicate of an existing source, tool, watch or feed',
    '  is the single most expensive mistake you can make here.',
    '- PREFER capabilities that bring NEW DATA into the building — a data source, a feed, or a watch that observes',
    '  something on a schedule — over another wrapper around data the site already holds. That preference is the',
    '  owner\'s standing instruction, not a tiebreak.',
    '- A "watch" is a recurring check that notifies when something changes; it is how triggers and workflows are',
    '  expressed here, so put them in that kind.',
    '- Prefer durable, authoritative, machine-readable sources over novelty APIs.',
    '- For investigation evidence requests, cite the investigation key and preserve the acceptance check. An existing lookup, waiting for data, or asking a question does not require a build.',
    '- Do not treat repeated proposals as additional evidence that a behavioural claim is true.',
    '- State the need (what is missing) and the value (what it unlocks, concretely) as separate sentences. "Would',
    '  be useful" is not a value.',
    '',
    'Respond with ONLY JSON: {"capabilities": [{"kind": ' +
      CAPABILITY_KINDS.map((k) => `"${k}"`).join('|') +
      ', "title": string, "need": string, "value": string, "consumer": "jkai"|"daydream"|"site"|"shared",',
    '  "cites": string[], "integrationHint": string}]}. No prose outside the JSON.',
  ].join('\n');
}

export async function runAppetite(opts: { maxLeads?: number } = {}): Promise<AppetiteResult> {
  const maxLeads = Math.max(1, Math.min(6, opts.maxLeads ?? DEFAULT_MAX_LEADS));
  const result: AppetiteResult = {
    packSizes: {},
    packFacts: 0,
    proposed: 0,
    admitted: 0,
    created: 0,
    refreshed: 0,
    dropped: [],
    bridged: { ...EMPTY_PERSIST, offered: 0 },
    tokens: { prompt: 0, completion: 0 },
    error: null,
  };

  const pack = await assembleAppetitePack();
  result.packSizes = pack.sizes;
  result.packFacts = pack.facts.length;

  // A pack with nothing asked and nothing missing is a quiet site, not a
  // reason to spend a call inventing wants for it.
  if (pack.sizes.questions === 0 && pack.sizes.gaps === 0) {
    result.error = null;
    return result;
  }

  let parsed: unknown;
  try {
    const model = await resolveDaydreamModel();
    const { client, model: modelId } = await getLLMClient(model);
    const res = await client.chat.completions.create({
      model: modelId,
      temperature: 0.6,
      // Room for reasoning tokens before the JSON — a GLM-class model that
      // thinks inside `max_tokens` returns an empty string otherwise.
      max_tokens: 3000,
      messages: [
        { role: 'system', content: systemPrompt(maxLeads) },
        { role: 'user', content: renderAppetitePack(pack) },
      ],
    });
    result.tokens.prompt = res.usage?.prompt_tokens ?? 0;
    result.tokens.completion = res.usage?.completion_tokens ?? 0;
    const raw = (res.choices[0]?.message?.content ?? '')
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    try {
      parsed = JSON.parse(raw);
    } catch {
      result.error = 'model did not return JSON';
      return result;
    }
  } catch (err) {
    result.error = errMsg(err);
    return result;
  }

  const proposalsIn = Array.isArray((parsed as { capabilities?: unknown } | null)?.capabilities)
    ? (parsed as { capabilities: unknown[] }).capabilities.length
    : 0;
  result.proposed = proposalsIn;

  const audit = validateProposals(parsed, pack.keys, { max: maxLeads });
  result.dropped = audit.dropped;
  result.admitted = audit.admitted.length;

  const written: Array<{ p: CapabilityProposal; slug: string }> = [];
  for (const p of audit.admitted) {
    const up = await upsertCapability(p);
    if (!up) continue;
    if (up.created) result.created++;
    else result.refreshed++;
    written.push({ p, slug: up.slug });
  }

  // Bridge from the LEDGER rather than the proposals, so a lead reaches the
  // thought path with its accumulated recurrence and its real score — a
  // second-night repeat is a stronger claim than a first-night idea, and
  // that is precisely the difference the score exists to carry.
  if (written.length) {
    try {
      const slugs = new Set(written.map((w) => w.slug));
      const rows = (await listCapabilities({ statuses: ['proposed'], limit: 60 })).filter((r) => slugs.has(r.slug));
      const candidates = rows
        .map((r) =>
          capabilityToCandidate({
            slug: r.slug,
            kind: r.kind,
            title: r.title,
            need: r.need,
            value: r.value,
            consumer: r.consumer,
            cites: r.cites,
            score: r.score,
            components: r.components,
            recurrence: r.recurrence,
          }),
        )
        .filter((c): c is NonNullable<typeof c> => c !== null);
      result.bridged.offered = candidates.length;
      if (candidates.length) {
        const persisted = await persistCandidates(candidates, { runId: `appetite-${Date.now()}` });
        result.bridged = { ...persisted, offered: candidates.length };
      }
    } catch (err) {
      // The ledger is the durable half; failing to bridge costs a briefing
      // line, not the night's thinking.
      result.error = `bridge failed: ${errMsg(err)}`;
    }
  }

  return result;
}
