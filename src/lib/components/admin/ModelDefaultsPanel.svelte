<script lang="ts">
  import { GLM_MODELS } from '$lib/constants/glm-models';
  import type { ModelContext } from '$lib/server/models/types';

  let { chat, builder }: { chat: ModelContext; builder: ModelContext } = $props();

  let chatVal = $state<ModelContext>({ ...chat });
  let builderVal = $state<ModelContext>({ ...builder });
  let openrouterOptions = $state<{ id: string; name: string }[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);

  async function loadOpenRouter() {
    const res = await fetch('/api/admin/models/openrouter?pageSize=500');
    if (res.ok) {
      const data = await res.json();
      openrouterOptions = data.rows.map((r: any) => ({ id: r.id, name: r.name }));
    }
  }

  $effect(() => { loadOpenRouter(); });

  function parseOption(v: string): ModelContext {
    if (v.startsWith('zai:')) return { provider: 'zai', modelId: v.slice(4) };
    return { provider: 'openrouter', modelId: v.slice('or:'.length) };
  }
  function serialise(ctx: ModelContext): string {
    return ctx.provider === 'zai' ? `zai:${ctx.modelId}` : `or:${ctx.modelId}`;
  }

  async function save() {
    saving = true; error = null; saved = false;
    try {
      const res = await fetch('/api/admin/models/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat: chatVal, builder: builderVal }),
      });
      if (!res.ok) throw new Error(await res.text());
      saved = true;
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }
</script>

<section>
  <h2>Default models</h2>

  <label>
    Default chat model
    <select value={serialise(chatVal)} onchange={(e) => chatVal = parseOption(e.currentTarget.value)}>
      <optgroup label="Z.AI">
        {#each GLM_MODELS as m}
          <option value={`zai:${m.id}`}>{m.label}</option>
        {/each}
      </optgroup>
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name} ({m.id})</option>
        {/each}
      </optgroup>
    </select>
  </label>

  <label>
    Default builder model
    <select value={serialise(builderVal)} onchange={(e) => builderVal = parseOption(e.currentTarget.value)}>
      <optgroup label="Z.AI">
        {#each GLM_MODELS as m}
          <option value={`zai:${m.id}`}>{m.label}</option>
        {/each}
      </optgroup>
      <optgroup label="OpenRouter">
        {#each openrouterOptions as m}
          <option value={`or:${m.id}`}>{m.name} ({m.id})</option>
        {/each}
      </optgroup>
    </select>
  </label>

  <button onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Save defaults'}</button>
  {#if saved}<span class="ok">Saved.</span>{/if}
  {#if error}<span class="err">{error}</span>{/if}
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; }
  .ok { color: green; margin-left: 0.5rem; }
  .err { color: crimson; margin-left: 0.5rem; }
</style>
