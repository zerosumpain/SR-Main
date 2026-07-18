<script lang="ts">
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
</script>

<label>
  {label}
  <select
    value={value.modelId}
    onchange={(e) => value = { provider: 'openrouter', modelId: e.currentTarget.value }}
  >
    {#each openrouterOptions as m}
      <option value={m.id}>{m.name}</option>
    {/each}
  </select>
</label>

<style>
  label { display: flex; flex-direction: column; gap: 0.25rem; }
</style>
