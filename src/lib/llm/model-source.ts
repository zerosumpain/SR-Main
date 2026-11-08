// src/lib/llm/model-source.ts — Main's implementation.
//
// The shared LLM files (`pricing`, `usage-capture`, `usage-log`) are identical in
// Main and the extracted applications. What differs is where the catalogue comes
// from and where a usage row goes, and that difference lives here: every
// repository has a `$lib/llm/model-source` with these two exports.
//
//   Main:          reads `openrouter_models`, inserts into `agent_actions`.
//   Applications:  read the catalogue Main serves at /api/platform/models/config
//                  and send usage to /api/platform/models/usage
//                  (`$lib/llm/model-service-client`).
//
// NOT a shared file. Keep the two exports' signatures in step with the
// applications' copies; their bodies are meant to differ.

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { agentActions, openrouterModels } from '$lib/db/schema';
import type { CatalogueModel } from '$lib/llm/model-service-contract';
import type { DurableLLMCall, LlmCallRow } from '$lib/llm/usage-log';

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) ? v.map((x) => String(x)) : null;
}

/** The OpenRouter catalogue, reduced to what model plumbing reads. */
export async function loadCatalogue(): Promise<CatalogueModel[]> {
  const rows = await db
    .select({
      id: openrouterModels.id,
      promptPrice: openrouterModels.promptPrice,
      completionPrice: openrouterModels.completionPrice,
      modality: openrouterModels.modality,
      maxCompletionTokens: sql<string | null>`${openrouterModels.raw} -> 'top_provider' ->> 'max_completion_tokens'`,
      inputModalities: sql<unknown>`${openrouterModels.raw} -> 'architecture' -> 'input_modalities'`,
      supportedParameters: sql<unknown>`${openrouterModels.raw} -> 'supported_parameters'`,
    })
    .from(openrouterModels);
  return rows.map((r) => ({
    id: r.id,
    promptPrice: finiteOrNull(r.promptPrice),
    completionPrice: finiteOrNull(r.completionPrice),
    maxCompletionTokens: finiteOrNull(r.maxCompletionTokens),
    inputModalities: stringList(r.inputModalities),
    modality: r.modality ?? null,
    supportedParameters: stringList(r.supportedParameters),
  }));
}

/** Main records its own calls straight into the ledger. */
export async function writeUsage(_call: DurableLLMCall, row: LlmCallRow): Promise<void> {
  await db.insert(agentActions).values(row);
}
