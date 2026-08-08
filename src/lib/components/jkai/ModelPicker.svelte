<script lang="ts">
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount } from 'svelte';

  /** `need` names the provider feature this picker's role requires. When a
   *  provider can't do it, its models are listed but disabled with the reason,
   *  rather than silently absent — an option you can see and can't pick tells
   *  you Codex exists and why it won't work here; a missing option tells you
   *  nothing. */
  let { value = $bindable(), label = 'Model', need = null }:
    { value: ModelContext; label?: string; need?: 'tools' | 'embeddings' | null } = $props();

  let openrouterOptions = $state<{ id: string; name: string }[]>([]);
  let codexOptions = $state<{ id: string; name: string }[]>([]);
  let codexBlockedReason = $state<string | null>(null);

  onMount(async () => {
    const [orRes, codexRes] = await Promise.all([
      fetch('/api/admin/models/openrouter?pageSize=500'),
      fetch('/api/admin/models/codex'),
    ]);
    if (orRes.ok) {
      const data = await orRes.json();
      openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
    }
    if (codexRes.ok) {
      const data = await codexRes.json();
      // Only offer Codex where the operator has switched it on AND the bridge
      // can actually serve a call.
      if (data.enabled && data.health?.ok) {
        codexOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
        codexBlockedReason =
          need === 'tools'
            ? 'Codex runs its own toolset and cannot accept this role’s function schemas'
            : need === 'embeddings'
              ? 'Codex has no embeddings endpoint'
              : null;
      }
    }
  });

  function pick(id: string) {
    value = { provider: id.startsWith('codex/') ? 'codex' : 'openrouter', modelId: id };
  }
</script>

<label>
  {label}
  <select value={value.modelId} onchange={(e) => pick(e.currentTarget.value)}>
    {#if codexOptions.length}
      <optgroup label={codexBlockedReason ? `Codex — unavailable here (${codexBlockedReason})` : 'Codex (subscription)'}>
        {#each codexOptions as m}
          <option value={m.id} disabled={codexBlockedReason !== null}>{m.name}</option>
        {/each}
      </optgroup>
      <optgroup label="OpenRouter (per token)">
        {#each openrouterOptions as m}
          <option value={m.id}>{m.name}</option>
        {/each}
      </optgroup>
    {:else}
      {#each openrouterOptions as m}
        <option value={m.id}>{m.name}</option>
      {/each}
    {/if}
  </select>
</label>

<style>
  label { display: flex; flex-direction: column; gap: 0.25rem; }
</style>
