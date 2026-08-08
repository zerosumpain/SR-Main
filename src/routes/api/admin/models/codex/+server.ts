import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CODEX_MODELS, toCodexModelId } from '$lib/server/models/codex-catalogue';
import { getCodexBridgeUrl, isCodexEnabled, setCodexEnabled } from '$lib/server/models/settings';

/**
 * Codex model list + bridge health, for the model pickers and
 * /admin/ai/models.
 *
 * Deliberately NOT merged into /api/admin/models/openrouter: that route serves
 * the `openrouter_models` table with DB-side filtering, sorting, scoring and
 * pagination over ~340 rows. Codex is five rows from a static table with no
 * prices and no benchmark indices, so unioning them in would mean faking
 * columns to satisfy the sort. Two sources, two endpoints, one merge in the UI.
 */

interface BridgeHealth {
  reachable: boolean;
  ok: boolean;
  loggedIn: boolean;
  authMode: string | null;
  codexVersion: string | null;
  error: string | null;
}

async function probeBridge(): Promise<BridgeHealth> {
  const dead: BridgeHealth = {
    reachable: false,
    ok: false,
    loggedIn: false,
    authMode: null,
    codexVersion: null,
    error: null,
  };
  try {
    const res = await fetch(`${getCodexBridgeUrl()}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    // 503 is a real answer from a running bridge that isn't logged in — it
    // still carries the diagnostic body, so don't treat !ok as unreachable.
    const body = (await res.json()) as Partial<BridgeHealth> & { ok?: boolean };
    return {
      reachable: true,
      ok: body.ok === true,
      loggedIn: body.loggedIn === true,
      authMode: body.authMode ?? null,
      codexVersion: body.codexVersion ?? null,
      error: body.ok ? null : 'Bridge is running but Codex is not usable — run `codex login --device-auth` on this host.',
    };
  } catch (err) {
    return { ...dead, error: err instanceof Error ? err.message : String(err) };
  }
}

export const GET: RequestHandler = async () => {
  const [health, enabled] = await Promise.all([probeBridge(), isCodexEnabled()]);
  return json({
    enabled,
    health,
    rows: CODEX_MODELS.map((m) => ({
      // The pickers persist this id, so it carries the provider prefix.
      id: toCodexModelId(m.slug),
      slug: m.slug,
      name: m.name,
      description: m.description,
      proOnly: m.proOnly ?? false,
      retiresOn: m.retiresOn ?? null,
      provider: 'codex' as const,
      // Explicit nulls rather than omitted keys: the picker renders "—" for
      // these and a missing key would read as a bug rather than as "Codex has
      // no per-token price / published context window".
      promptPrice: null,
      completionPrice: null,
      contextLength: null,
      subscription: true,
    })),
  });
};

/** Toggle whether Codex models may be selected at all. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { enabled?: boolean };
  const enabled = body.enabled === true;

  // Refuse to switch on a provider that cannot serve a call — otherwise the
  // models appear in every picker and fail at run time, which reads as a site
  // bug rather than as "log in on this host".
  if (enabled) {
    const health = await probeBridge();
    if (!health.ok) {
      return json(
        { enabled: false, health, error: health.error ?? 'Codex bridge is not reachable.' },
        { status: 409 },
      );
    }
  }

  await setCodexEnabled(enabled);
  return json({ enabled });
};
