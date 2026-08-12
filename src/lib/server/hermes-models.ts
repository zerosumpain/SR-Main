/**
 * Homeserv-local read/write of the model Hermes uses for each of its own roles.
 *
 * Hermes is a second model-configuration system. The site's `app_settings`
 * default reaches only code that calls `resolveDefaultModel()`; every Hermes
 * session the site does not explicitly re-model — WhatsApp DMs, canvas chats,
 * smoke turns — runs on `model.default` from `~/.hermes-jkai/config.yaml`, and
 * its delegation children, fallback and auxiliary calls run on their own keys.
 * None of that traffic reaches the SvelteKit gateway, so none of it appears in
 * `agent_actions` either: it was both uncontrolled and unmeasured.
 *
 * WHY THE CLI AND NOT YAML. `hermes config get|set` is the sanctioned path.
 * Hand-editing config.yaml round-trips badly — the gateway rewrites key order
 * on restart, so a diff-based edit fights the process that owns the file.
 *
 * Like `hermes-control.ts`, everything here shells out locally and is therefore
 * homeserv-only; the VPS reaches it through the proxy in `hermes-remote.ts`.
 */
import { HERMES_BIN, runShell, type ActionResult } from './hermes-control';
import { HERMES_WORKLOADS, type WorkloadDef } from '$lib/models/workloads';

const GET_TIMEOUT_MS = 10_000;
const SET_TIMEOUT_MS = 15_000;
const RESTART_TIMEOUT_MS = 180_000;
const GATEWAY_UNIT = 'jkai-hermes.service';

export interface HermesWorkloadRow {
  id: string;
  /** Model as Hermes stores it — a BARE slug for Codex, no `codex/` prefix. */
  rawModelId: string | null;
  /** Model in our id space, so the picker can compare it against a catalogue row. */
  modelId: string | null;
  /** Hermes' provider name: `openrouter`, `openai-codex`, `auto`, … */
  provider: string | null;
}

/**
 * Hermes' provider names → ours, and back.
 *
 * Hermes calls the Codex transport `openai-codex` and wants the bare slug; we
 * carry a `codex/` prefix so the provider is recoverable from the id alone.
 * Converting at this boundary keeps that prefix rule intact everywhere else.
 */
function toOurId(rawModelId: string | null, provider: string | null): string | null {
  if (!rawModelId) return null;
  if (provider === 'openai-codex' && !rawModelId.startsWith('codex/')) {
    return `codex/${rawModelId}`;
  }
  return rawModelId;
}

export function toHermesModel(modelId: string): { model: string; provider: string } {
  return modelId.startsWith('codex/')
    ? { model: modelId.slice('codex/'.length), provider: 'openai-codex' }
    : { model: modelId, provider: 'openrouter' };
}

/** One `hermes config get`. Returns null for an unset key or any failure —
 *  "not configured" and "could not read" both mean the picker should show a
 *  dash rather than a value it cannot stand behind. */
async function configGet(key: string): Promise<string | null> {
  const r = await runShell(`config_get:${key}`, HERMES_BIN, ['config', 'get', key], GET_TIMEOUT_MS);
  if (!r.ok) return null;
  const v = r.stdout.trim();
  // Hermes prints an empty line for a set-but-blank key (the `auxiliary.*`
  // entries default to `model: ''`), which means "inherit", not a model name.
  return v && v !== 'None' && v !== 'null' ? v : null;
}

/** Every Hermes role's current model + provider. Reads run concurrently: each
 *  CLI invocation costs a few hundred ms and there are a dozen keys. */
export async function readHermesWorkloads(): Promise<HermesWorkloadRow[]> {
  return Promise.all(
    HERMES_WORKLOADS.map(async (w) => {
      const [rawModelId, provider] = await Promise.all([
        configGet(w.key),
        w.providerKey ? configGet(w.providerKey) : Promise.resolve(null),
      ]);
      return { id: w.id, rawModelId, modelId: toOurId(rawModelId, provider), provider };
    }),
  );
}

/**
 * Point a Hermes role at a model and restart the gateway so it takes effect.
 *
 * The model and its provider are written as a PAIR — see `providerKey` in the
 * registry for why a lone model write leaves the engine calling the wrong API.
 *
 * The restart is not optional and not deferred: Hermes reads config.yaml at
 * start-up, so without it the UI would report a change that has not happened,
 * which is the exact failure this whole feature exists to remove.
 */
export async function setHermesWorkload(
  def: WorkloadDef,
  modelId: string,
): Promise<ActionResult> {
  const { model, provider } = toHermesModel(modelId);

  const setModel = await runShell(
    `config_set:${def.key}`,
    HERMES_BIN,
    ['config', 'set', def.key, model],
    SET_TIMEOUT_MS,
  );
  if (!setModel.ok) return setModel;

  if (def.providerKey) {
    const setProvider = await runShell(
      `config_set:${def.providerKey}`,
      HERMES_BIN,
      ['config', 'set', def.providerKey, provider],
      SET_TIMEOUT_MS,
    );
    if (!setProvider.ok) return setProvider;
  }

  const restart = await runShell(
    'restart_gateway',
    'systemctl',
    ['--user', 'restart', GATEWAY_UNIT],
    RESTART_TIMEOUT_MS,
  );
  return {
    ...restart,
    action: `set_hermes_workload:${def.id}`,
    stdout: `[set ${def.key}=${model}]\n${setModel.stdout}\n\n[restart]\n${restart.stdout}`,
  };
}
