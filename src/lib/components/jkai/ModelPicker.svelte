<script lang="ts">
  import { GLM_MODELS } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount } from 'svelte';

  let { value = $bindable(), label = 'Model' }: { value: ModelContext; label?: string } = $props();

  let openrouterOptions = $state<{ id: string; name: string }[]>([]);

  onMount(async () => {
    const res = await fetch('/api/admin/models/openrouter?pageSize=500');
    if (res.ok) {
      const data = await res.json();
      openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
    }
  });

  function serialise(ctx: ModelContext): string {
    return ctx.provider === 'zai' ? `zai:${ctx.modelId}` : `or:${ctx.modelId}`;
  }
  function parse(v: string): ModelContext {
    if (v.startsWith('zai:')) return { provider: 'zai', modelId: v.slice(4) };
    return { provider: 'openrouter', modelId: v.slice(3) };
  }
</script>

<label>
  {label}
  <select value={serialise(value)} onchange={(e) => value = parse(e.currentTarget.value)}>
    <optgroup label="Z.AI">
      {#each GLM_MODELS as m}
        <option value={`zai:${m.id}`}>{m.label}</option>
      {/each}
    </optgroup>
    {#if openrouterOptions.length > 0}
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name}</option>
        {/each}
      </optgroup>
    {/if}
  </select>
</label>

<style>
  label { display: flex; flex-direction: column; gap: 0.25rem; }
</style>
