/**
 * Nightly Codex model discovery: what the subscription can run that
 * CODEX_MODELS does not know about yet.
 *
 * GPT-6 Sol and Luna sat unused for days (2026-09-25, PR #957) because the
 * catalogue is a hand-kept array and nothing looked. This looks, and it has to
 * work around the Codex model list being wrong in both directions
 * (see ./codex-catalogue and $lib/models/thinking):
 *
 *  - The list HIDES a model from an old client. Every row carries a
 *    `minimal_client_version` and the listing is filtered by the
 *    `client_version` we ask with. We pin an old SDK, so asking as ourselves
 *    would never show a new model. We ask as the latest `@openai/codex` on npm.
 *  - The list ADVERTISES a reasoning effort the API refuses (`ultra`). So
 *    nothing is taken on its word. Each new model gets one tiny request at
 *    `max`, then `xhigh`, and only a model that answers is offered. Its ceiling
 *    is the effort that worked.
 *
 * Found models live in one settings row. `listCodexModels()` merges them under
 * the static table, which still wins for any slug it names, so a hand-written
 * row always overrides a discovered one.
 *
 * It runs from the nightly model-routing job ($lib/routing/run), next to the
 * OpenRouter catalogue refresh, and on demand from
 * POST /api/admin/models/codex/refresh.
 */
import { CODEX_MODELS, toCodexModelId, type CodexModel } from './codex-catalogue';
import { codexBackendHeaders, fetchThroughChallenge, readCodexAuth } from './codex-usage';
import { getSetting, setSetting } from './settings';
import {
  CODEX_EFFORT_CEILING,
  registerCodexEffortCeilings,
  type ThinkingLevel,
} from '$lib/models/thinking';

const SETTING_KEY = 'codex.discovered_models';
const CATALOGUE_URL = 'https://chatgpt.com/backend-api/codex/models';
const NPM_LATEST_URL = 'https://registry.npmjs.org/@openai/codex/latest';

/** What to ask as when npm cannot be reached. The version current when this
 *  was written. A stale floor only means a newer model stays hidden until npm
 *  answers again; it never offers something that does not work. */
export const CODEX_CLIENT_VERSION_FLOOR = '0.157.0';

/** New models tested per run. A new generation has been three models at most;
 *  this only bounds the quota a strange night could spend. */
const MAX_PROBES_PER_RUN = 6;

/** Tried in order. `max` first because it is the top rung this transport can
 *  send; a model that refuses it BY NAME gets `xhigh`, which every Codex model
 *  has taken. */
const PROBE_EFFORTS = ['max', 'xhigh'] as const satisfies readonly ThinkingLevel[];

export interface DiscoveredCodexModel {
  slug: string;
  name: string;
  description: string;
  effortCeiling: ThinkingLevel;
  inputModalities: string[];
  discoveredAt: string;
}

interface DiscoveryState {
  checkedAt: string;
  clientVersion: string;
  models: DiscoveredCodexModel[];
  /** Static CODEX_MODELS slugs the list no longer names at all, kept so a
   *  model going missing is reported once, not every night. */
  unlisted: string[];
}

/** A picker row: the static entry or a discovered one, with its ceiling. */
export type ListedCodexModel = CodexModel & {
  effortCeiling: ThinkingLevel;
  discovered: boolean;
};

export interface CatalogueRow {
  slug: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  input_modalities?: string[];
}

export interface CodexDiscoveryReport {
  clientVersion: string;
  listed: number;
  added: DiscoveredCodexModel[];
  rejected: { slug: string; reason: string }[];
  dropped: string[];
  newlyUnlisted: string[];
  notified: boolean;
}

// ─── the list ────────────────────────────────────────────────────────────────

export async function latestCodexClientVersion(): Promise<string> {
  try {
    const res = await fetch(NPM_LATEST_URL, { signal: AbortSignal.timeout(6_000) });
    if (res.ok) {
      const v = ((await res.json()) as { version?: unknown }).version;
      if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) return v;
    }
  } catch {
    /* fall through to the floor */
  }
  return CODEX_CLIENT_VERSION_FLOOR;
}

/** The subscription's model list as `clientVersion` sees it, or null when
 *  there is no Codex login on this host or chatgpt.com refused. */
export async function fetchCodexCatalogue(clientVersion: string): Promise<CatalogueRow[] | null> {
  const auth = await readCodexAuth();
  if (!auth) return null;
  const url = `${CATALOGUE_URL}?client_version=${encodeURIComponent(clientVersion)}`;
  const res = await fetchThroughChallenge(codexBackendHeaders(auth), url);
  if (!res.ok) {
    console.warn(`[codex-discovery] model list returned ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { models?: unknown };
  if (!Array.isArray(body.models)) return null;
  return body.models.filter(
    (m): m is CatalogueRow => typeof (m as CatalogueRow)?.slug === 'string',
  );
}

/** `GPT-6-Sol` → `GPT-6 Sol`, `GPT-5.3-Codex-Spark` → `GPT-5.3 Codex Spark`,
 *  matching how the static table spells names. */
export function prettyCodexName(displayName: string): string {
  const m = /^(GPT-[\d.]+)-(.+)$/i.exec(displayName);
  return m ? `${m[1]} ${m[2].replace(/-/g, ' ')}` : displayName.replace(/-/g, ' ');
}

// ─── the probe ───────────────────────────────────────────────────────────────

export type ProbeResult = { ok: true; effortCeiling: ThinkingLevel } | { ok: false; reason: string };
type ProbeSend = (slug: string, effort: ThinkingLevel) => Promise<void>;

/** One minimal request through the site's own gateway, so the probe tests the
 *  same path a real call takes. No retries: a refusal is the answer. */
const sendThroughGateway: ProbeSend = async (slug, effort) => {
  const { getLLMClient } = await import('$lib/llm/client');
  const { client, model } = await getLLMClient({ provider: 'codex', modelId: toCodexModelId(slug) });
  // `reasoning_effort` is typed narrower than the rungs Codex takes.
  const body = {
    model,
    messages: [{ role: 'user' as const, content: 'Reply with just: ok' }],
    reasoning_effort: effort,
  } as unknown as Parameters<typeof client.chat.completions.create>[0];
  await client.chat.completions.create(body, { maxRetries: 0, timeout: 90_000 });
};

/**
 * Does the subscription serve `slug`, and how deep will it reason?
 *
 * The API names the effort when it refuses one (`Unsupported value: 'max' is
 * not supported with the 'gpt-5.5' model`), so a refusal naming the effort
 * steps down a rung. Anything else, including `The 'gpt-6-terra' model is not
 * supported when using Codex with a ChatGPT account`, means the model is not
 * usable and it is not offered.
 */
export async function probeCodexModel(slug: string, send: ProbeSend = sendThroughGateway): Promise<ProbeResult> {
  let reason = 'refused every effort tried';
  for (const effort of PROBE_EFFORTS) {
    try {
      await send(slug, effort);
      return { ok: true, effortCeiling: effort };
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
      if (!reason.includes(`'${effort}'`)) return { ok: false, reason };
    }
  }
  return { ok: false, reason };
}

// ─── the stored result ───────────────────────────────────────────────────────

let registered = false;

async function readState(): Promise<DiscoveryState | null> {
  const state = await getSetting<DiscoveryState>(SETTING_KEY);
  if (!state || !Array.isArray(state.models)) return null;
  if (!registered) {
    registerCodexEffortCeilings(state.models);
    registered = true;
  }
  return state;
}

/** The discovered models, registering their ceilings on first read. Empty on
 *  any failure: the static table on its own is always a working answer. */
export async function loadDiscoveredCodexModels(): Promise<DiscoveredCodexModel[]> {
  try {
    return (await readState())?.models ?? [];
  } catch (err) {
    console.warn('[codex-discovery] could not read discovered models:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Every Codex model a picker should offer: the static table, then anything
 *  discovery found that the table does not name. */
export async function listCodexModels(): Promise<ListedCodexModel[]> {
  const staticSlugs = new Set(CODEX_MODELS.map((m) => m.slug));
  const discovered = await loadDiscoveredCodexModels();
  return [
    ...CODEX_MODELS.map((m) => ({
      ...m,
      effortCeiling: CODEX_EFFORT_CEILING[m.slug] ?? 'xhigh',
      discovered: false,
    })),
    ...discovered
      .filter((d) => !staticSlugs.has(d.slug))
      .map((d) => ({
        slug: d.slug,
        name: d.name,
        description: d.description,
        effortCeiling: d.effortCeiling,
        discovered: true,
      })),
  ];
}

// ─── the nightly run ─────────────────────────────────────────────────────────

export interface RefreshDeps {
  clientVersion?: () => Promise<string>;
  fetchCatalogue?: (clientVersion: string) => Promise<CatalogueRow[] | null>;
  probe?: (slug: string) => Promise<ProbeResult>;
  notify?: boolean;
}

export async function refreshCodexCatalogue(deps: RefreshDeps = {}): Promise<CodexDiscoveryReport> {
  const clientVersion = await (deps.clientVersion ?? latestCodexClientVersion)();
  const rows = await (deps.fetchCatalogue ?? fetchCodexCatalogue)(clientVersion);
  if (!rows) throw new Error('Codex model list unavailable (no login on this host, or chatgpt.com refused)');

  const probe = deps.probe ?? ((slug: string) => probeCodexModel(slug));
  const staticSlugs = new Set(CODEX_MODELS.map((m) => m.slug));
  const listed = rows.filter((r) => r.visibility === 'list');
  const listedSlugs = new Set(listed.map((r) => r.slug));
  const anySlugs = new Set(rows.map((r) => r.slug));

  const prev = await readState().catch(() => null);
  const prevBySlug = new Map((prev?.models ?? []).map((m) => [m.slug, m]));

  const now = new Date().toISOString();
  const models: DiscoveredCodexModel[] = [];
  const added: DiscoveredCodexModel[] = [];
  const rejected: { slug: string; reason: string }[] = [];
  let probes = 0;

  for (const row of listed) {
    if (staticSlugs.has(row.slug)) continue;
    const describe = {
      name: prettyCodexName(row.display_name ?? row.slug),
      description: row.description ?? 'Found in the Codex model list by the nightly check.',
      inputModalities: row.input_modalities ?? ['text'],
    };
    const known = prevBySlug.get(row.slug);
    if (known) {
      // Tested on an earlier night. Keep its ceiling and pick up any new wording.
      models.push({ ...known, ...describe });
      continue;
    }
    if (probes >= MAX_PROBES_PER_RUN) continue;
    probes++;
    const result = await probe(row.slug);
    if (result.ok) {
      const model = { slug: row.slug, ...describe, effortCeiling: result.effortCeiling, discoveredAt: now };
      models.push(model);
      added.push(model);
    } else {
      rejected.push({ slug: row.slug, reason: result.reason.slice(0, 300) });
    }
  }

  const dropped = [...prevBySlug.keys()].filter((slug) => !listedSlugs.has(slug) && !staticSlugs.has(slug));
  const unlisted = CODEX_MODELS.map((m) => m.slug).filter((slug) => !anySlugs.has(slug));
  const prevUnlisted = new Set(prev?.unlisted ?? []);
  const newlyUnlisted = unlisted.filter((slug) => !prevUnlisted.has(slug));

  await setSetting(SETTING_KEY, { checkedAt: now, clientVersion, models, unlisted } satisfies DiscoveryState);
  registerCodexEffortCeilings(models);
  registered = true;

  let notified = false;
  if (deps.notify !== false && (added.length || dropped.length || newlyUnlisted.length)) {
    notified = await notifyChange(added, dropped, newlyUnlisted);
  }

  return { clientVersion, listed: listed.length, added, rejected, dropped, newlyUnlisted, notified };
}

async function notifyChange(
  added: DiscoveredCodexModel[],
  dropped: string[],
  newlyUnlisted: string[],
): Promise<boolean> {
  const lines: string[] = [];
  for (const m of added) lines.push(`Added: ${m.name} (${m.slug}), reasons up to ${m.effortCeiling}.`);
  for (const slug of dropped) lines.push(`Removed: ${slug} is no longer in the Codex list.`);
  for (const slug of newlyUnlisted) {
    lines.push(`Missing: ${slug} is in CODEX_MODELS but no longer in the Codex list. Check it still answers, or retire the row.`);
  }
  const title = added.length
    ? `New Codex model${added.length > 1 ? 's' : ''}: ${added.map((m) => m.name).join(', ')}`
    : 'Codex model list changed';
  try {
    const { notifyOwner } = await import('$lib/server/notify');
    const result = await notifyOwner({
      category: 'system',
      severity: 'info',
      title,
      body: lines.join('\n'),
      url: '/admin/ai/models',
      dedupeKey: `codex-models:${[...added.map((m) => m.slug), ...dropped, ...newlyUnlisted].sort().join(',')}`,
    });
    return result.raised;
  } catch (err) {
    console.warn('[codex-discovery] notify failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
