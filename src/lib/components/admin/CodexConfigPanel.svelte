<script lang="ts">
  /**
   * Codex provider status + on/off switch. Mirrors OpenRouterConfigPanel's
   * shape, but there is no key to paste: the credential is the ChatGPT OAuth
   * token held by the bridge process, established once per host with
   * `codex login --device-auth`. So this panel diagnoses rather than
   * configures — it tells you which of the three things is missing (bridge
   * down / not logged in / disabled) and lets you flip the last one.
   */
  interface BridgeHealth {
    reachable: boolean;
    ok: boolean;
    loggedIn: boolean;
    authMode: string | null;
    codexVersion: string | null;
    error: string | null;
  }

  let { enabled: initialEnabled, health, modelCount }:
    { enabled: boolean; health: BridgeHealth; modelCount: number } = $props();

  let enabled = $state(initialEnabled);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let msg = $state<string | null>(null);

  async function toggle() {
    saving = true; errorMsg = null; msg = null;
    const next = !enabled;
    try {
      const res = await fetch('/api/admin/models/codex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Could not change the setting');
      enabled = body.enabled;
      msg = enabled ? 'Codex models are now selectable.' : 'Codex models hidden from the pickers.';
    } catch (e: any) { errorMsg = e.message; }
    finally { saving = false; }
  }

  // The one thing standing between "off" and "usable", in the order you'd fix
  // them. Kept as a single derived string so the panel never shows two
  // contradictory hints at once.
  const blocker = $derived(
    !health.reachable
      ? 'The bridge is not running on this host. Start jkai-codex-bridge.'
      : !health.loggedIn
        ? 'The bridge is up but not authenticated. Run `codex login --device-auth` as the service user.'
        : null,
  );
</script>

<section
  class="p-5"
  style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-round);"
>
  <h2
    class="text-sm uppercase tracking-wider mb-4"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    Codex subscription
  </h2>

  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-4" style="color: var(--text-secondary);">
    <span>
      Bridge:
      {#if health.ok}
        <span
          class="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); font-family: var(--font-mono);"
        >
          ready
        </span>
        {#if health.codexVersion}
          <span style="color: var(--text-ghost);">(codex {health.codexVersion})</span>
        {/if}
      {:else}
        <span
          class="ml-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider"
          style="background: var(--error-bg); color: var(--error); font-family: var(--font-mono);"
        >
          {health.reachable ? 'not authenticated' : 'unreachable'}
        </span>
      {/if}
    </span>
    <span>
      Billing:
      <strong style="color: var(--text-primary);">
        {health.authMode === 'api-key' ? 'per-token API key' : 'ChatGPT subscription'}
      </strong>
    </span>
    <span>
      Catalogue:
      <strong style="color: var(--text-primary);">{modelCount}</strong>
      models
    </span>
  </div>

  {#if blocker}
    <p class="text-xs mb-4" style="color: var(--error);">{blocker}</p>
  {:else if health.authMode === 'api-key'}
    <p class="text-xs mb-4" style="color: var(--text-secondary);">
      The bridge is authenticated with an OpenAI API key, not the ChatGPT subscription — these
      calls are billed per token on top of the subscription. Re-run
      <code>codex login</code> without <code>--with-api-key</code> to use the subscription.
    </p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    <button
      class="rounded px-4 py-2 text-sm font-medium"
      style="background: {enabled ? 'var(--surface-elevated)' : 'var(--accent)'}; color: {enabled ? 'var(--text-primary)' : 'white'}; border: 1px solid var(--card-border); {saving || (!health.ok && !enabled) ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
      onclick={toggle}
      disabled={saving || (!health.ok && !enabled)}
    >
      {saving ? 'Saving…' : enabled ? 'Disable Codex models' : 'Enable Codex models'}
    </button>
    {#if msg}
      <span class="text-xs" style="color: var(--accent);">{msg}</span>
    {/if}
    {#if errorMsg}
      <span class="text-xs" style="color: var(--error);">{errorMsg}</span>
    {/if}
  </div>

  <p class="text-xs mt-4" style="color: var(--text-ghost);">
    Codex calls cost no cash but do spend a finite weekly quota — the same one the Codex CLI uses.
    They cannot serve tool-calling or embedding roles, which stay on OpenRouter.
  </p>
</section>
