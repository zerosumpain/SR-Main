<script lang="ts">
  type Facets = {
    entityTypes: string[];
    tags: string[];
    timeRange: { from: string; to: string } | null;
    ordering: 'recent' | 'relevant';
    limit: number;
  };

  let { facets = $bindable(), onchange, onclose } = $props<{
    facets: Facets;
    onchange: (next: Facets) => void;
    onclose: () => void;
  }>();

  const PRESETS: Array<{ label: string; value: 'all' | 'today' | 'yesterday' | '7d' | '30d' }> = [
    { label: 'All time', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'Last 7 days', value: '7d' },
    { label: 'Last 30 days', value: '30d' },
  ];

  function applyPreset(p: 'all' | 'today' | 'yesterday' | '7d' | '30d') {
    const now = new Date();
    let from: Date | null = null;
    let to: Date = now;
    if (p === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (p === 'yesterday') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (p === '7d') {
      from = new Date(now.getTime() - 7 * 86_400_000);
    } else if (p === '30d') {
      from = new Date(now.getTime() - 30 * 86_400_000);
    }
    const next: Facets = {
      ...facets,
      timeRange: from ? { from: from.toISOString(), to: to.toISOString() } : null,
    };
    onchange(next);
  }

  function setOrdering(v: 'recent' | 'relevant') {
    onchange({ ...facets, ordering: v });
  }
</script>

<div class="facet-popover" role="dialog">
  <button type="button" class="close" onclick={onclose} aria-label="Close">×</button>
  <div class="section">
    <div class="label">TIME</div>
    {#each PRESETS as p}
      <button
        type="button"
        class="chip"
        onclick={() => applyPreset(p.value)}
      >{p.label}</button>
    {/each}
  </div>
  <div class="section">
    <div class="label">ORDERING</div>
    <button type="button" class="chip" class:active={facets.ordering === 'relevant'} onclick={() => setOrdering('relevant')}>Relevant</button>
    <button type="button" class="chip" class:active={facets.ordering === 'recent'} onclick={() => setOrdering('recent')}>Recent</button>
  </div>
</div>

<style>
  .facet-popover {
    position: absolute;
    background: var(--bg);
    border: 1px solid var(--text-primary);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 11px;
    min-width: 220px;
    z-index: 20;
  }
  .close {
    position: absolute;
    right: 6px;
    top: 4px;
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 14px;
  }
  .section { margin: 6px 0; }
  .label {
    color: var(--text-muted);
    letter-spacing: 0.08em;
    font-size: 10px;
    margin-bottom: 4px;
  }
  .chip {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: 12px;
    padding: 2px 8px;
    margin: 2px 4px 2px 0;
    font-size: 10px;
    cursor: pointer;
  }
  .chip:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .chip.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
</style>
