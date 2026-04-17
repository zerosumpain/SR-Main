<script lang="ts">
  interface ModelRow {
    id: string;
    name: string;
    provider: string;
    modality: string | null;
    contextLength: number | null;
    promptPrice: string | null;
    completionPrice: string | null;
  }

  let q = $state('');
  let provider = $state('');
  let modality = $state('');
  let minContext = $state<number | null>(null);
  let maxCostPerM = $state<number | null>(null);
  let page = $state(1);
  const pageSize = 50;

  let rows = $state<ModelRow[]>([]);
  let total = $state(0);
  let loading = $state(false);

  async function load() {
    loading = true;
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (provider) params.set('provider', provider);
      if (modality) params.set('modality', modality);
      if (minContext != null) params.set('minContext', String(minContext));
      if (maxCostPerM != null) params.set('maxCostPerM', String(maxCostPerM));
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        rows = data.rows; total = data.total;
      }
    } finally { loading = false; }
  }

  $effect(() => { load(); });

  function perMillion(pricePerToken: string | null): string {
    if (!pricePerToken) return '—';
    const perM = Number(pricePerToken) * 1_000_000;
    return `$${perM.toFixed(2)}`;
  }

  async function setAsDefault(kind: 'chat' | 'builder', id: string) {
    const body = kind === 'chat'
      ? { chat: { provider: 'openrouter', modelId: id } }
      : { builder: { provider: 'openrouter', modelId: id } };
    const res = await fetch('/api/admin/models/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) alert(`Set ${id} as ${kind} default.`);
  }
</script>

<section>
  <h2>Browse OpenRouter models</h2>

  <div class="filters">
    <input placeholder="Search…" bind:value={q} oninput={() => { page = 1; }} />
    <input placeholder="Provider (e.g. anthropic)" bind:value={provider} oninput={() => { page = 1; }} />
    <input placeholder="Modality (e.g. text->text)" bind:value={modality} oninput={() => { page = 1; }} />
    <input type="number" placeholder="Min context" bind:value={minContext} oninput={() => { page = 1; }} />
    <input type="number" step="0.01" placeholder="Max $/1M completion" bind:value={maxCostPerM} oninput={() => { page = 1; }} />
  </div>

  <p>{total} models · page {page} of {Math.max(1, Math.ceil(total / pageSize))}</p>

  <table>
    <thead>
      <tr><th>ID</th><th>Name</th><th>Provider</th><th>Modality</th><th>Context</th><th>Prompt $/1M</th><th>Completion $/1M</th><th></th></tr>
    </thead>
    <tbody>
      {#each rows as m}
        <tr>
          <td><code>{m.id}</code></td>
          <td>{m.name}</td>
          <td>{m.provider}</td>
          <td>{m.modality ?? '—'}</td>
          <td>{m.contextLength ?? '—'}</td>
          <td>{perMillion(m.promptPrice)}</td>
          <td>{perMillion(m.completionPrice)}</td>
          <td>
            <button onclick={() => setAsDefault('chat', m.id)}>Chat</button>
            <button onclick={() => setAsDefault('builder', m.id)}>Builder</button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="pager">
    <button disabled={page <= 1} onclick={() => page--}>Prev</button>
    <button disabled={page * pageSize >= total} onclick={() => page++}>Next</button>
  </div>
</section>

<style>
  section { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  h2 { margin: 0; font-size: 1.1rem; }
  .filters { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .filters input { min-width: 140px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; border-bottom: 1px solid #eee; padding: 0.4rem 0.5rem; }
  code { font-size: 0.8rem; }
  .pager { display: flex; gap: 0.5rem; }
</style>
