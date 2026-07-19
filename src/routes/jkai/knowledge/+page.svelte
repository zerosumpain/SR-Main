<script lang="ts">
  import type { KnowledgeHit, KnowledgeSource } from '$lib/knowledge/search';

  const SOURCES: { key: KnowledgeSource; label: string }[] = [
    { key: 'files', label: 'Files' },
    { key: 'research', label: 'Research' },
    { key: 'memory', label: 'Memory' },
    { key: 'datastore', label: 'Datastore' },
  ];

  let query = $state('');
  let active = $state<Set<KnowledgeSource>>(new Set(['files', 'research', 'memory', 'datastore']));
  let loading = $state(false);
  let ran = $state(false);
  let hits = $state<KnowledgeHit[]>([]);
  let counts = $state<Record<string, number>>({});
  let errors = $state<Record<string, string>>({});
  let errMsg = $state<string | null>(null);

  function toggle(s: KnowledgeSource) {
    const next = new Set(active);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    active = next;
  }

  async function run() {
    const q = query.trim();
    if (!q || loading) return;
    loading = true;
    errMsg = null;
    try {
      const res = await fetch('/api/jkai/knowledge/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, sources: [...active] }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      hits = data.hits ?? [];
      counts = data.counts ?? {};
      errors = data.errors ?? {};
      ran = true;
    } catch (e) {
      errMsg = e instanceof Error ? e.message : 'Search failed';
    } finally {
      loading = false;
    }
  }

  function linkFor(h: KnowledgeHit): string | null {
    if (h.source === 'research' && h.ref.sessionId) return `/deepdive/${h.ref.sessionId}`;
    if (h.source === 'datastore') return `/admin/ai/datastore`;
    if (h.source === 'files') return `/drive`;
    return null;
  }
</script>

<svelte:head><title>Knowledge · JKAI</title></svelte:head>

<main class="kn">
  <header class="kn-hdr">
    <div class="kn-kicker">JKAI · Recall</div>
    <h1>Knowledge</h1>
    <p class="kn-sub">One search across your files, research, memory, and datastore. The <code>@knowledge</code> recall.</p>
    <a class="kn-back" href="/jkai">← back to jkai</a>
  </header>

  <section class="kn-search">
    <div class="kn-row">
      <input
        class="kn-input"
        type="text"
        placeholder="what do I know about…"
        bind:value={query}
        onkeydown={(e) => { if (e.key === 'Enter') run(); }}
      />
      <button class="kn-go" onclick={run} disabled={loading || !query.trim()}>{loading ? '…' : 'Recall'}</button>
    </div>
    <div class="kn-sources">
      {#each SOURCES as s (s.key)}
        <button class="kn-src" class:on={active.has(s.key)} onclick={() => toggle(s.key)}>
          {s.label}{#if ran && counts[s.key] !== undefined}<span class="kn-count"> {counts[s.key]}</span>{/if}
        </button>
      {/each}
    </div>
  </section>

  {#if errMsg}
    <p class="kn-err">⚠ {errMsg}</p>
  {/if}

  {#if ran && !loading}
    {#if hits.length === 0}
      <p class="kn-empty">Nothing matched across the selected stores.</p>
    {:else}
      <p class="kn-summary">{hits.length} hit{hits.length === 1 ? '' : 's'} across {Object.values(counts).filter((n) => n > 0).length} store(s).</p>
      <ul class="kn-hits">
        {#each hits as h, i (i)}
          {@const href = linkFor(h)}
          <li class="kn-hit">
            <div class="kn-hit-hd">
              <span class="kn-badge kn-badge-{h.source}">{h.source}</span>
              <span class="kn-title">{h.title}</span>
              <span class="kn-score">{h.matchKind === 'semantic' ? h.score.toFixed(2) : 'match'}</span>
            </div>
            <p class="kn-passage">{h.passage}</p>
            {#if href}<a class="kn-open" href={href}>open →</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if Object.keys(errors).length}
      <p class="kn-src-err">Some stores were unavailable: {Object.entries(errors).map(([k, v]) => `${k} (${v})`).join(', ')}</p>
    {/if}
  {/if}
</main>

<style>
  .kn { max-width: 860px; margin: 0 auto; padding: 32px 20px 80px; color: var(--text-primary); }
  .kn-hdr { border-bottom: 2px solid var(--card-border); padding-bottom: 16px; margin-bottom: 20px; }
  .kn-kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .kn-hdr h1 { font-family: var(--font-display, var(--font-sans)); font-size: 34px; margin: 4px 0 2px; }
  .kn-sub { margin: 0; color: var(--text-muted); font-size: 13px; }
  .kn-sub code { font-family: var(--font-mono); color: var(--accent-ink, var(--accent)); }
  .kn-back { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-decoration: none; }
  .kn-back:hover { color: var(--text-primary); }

  .kn-search { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
  .kn-row { display: flex; gap: 8px; }
  .kn-input { flex: 1; padding: 10px 12px; background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: 14px; outline: none; }
  .kn-input:focus { border-color: var(--text-muted); }
  .kn-go { padding: 0 18px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; font-family: var(--font-mono); font-size: 12px; cursor: pointer; }
  .kn-go:disabled { opacity: 0.5; cursor: default; }

  .kn-sources { display: flex; gap: 6px; flex-wrap: wrap; }
  .kn-src { font-family: var(--font-mono); font-size: 11px; padding: 4px 10px; background: transparent; border: 1px solid var(--card-border); color: var(--text-ghost); cursor: pointer; }
  .kn-src.on { color: var(--text-primary); border-color: var(--text-muted); background: color-mix(in srgb, var(--card-border) 18%, transparent); }
  .kn-count { color: var(--text-ghost); }

  .kn-err { color: var(--status-error, #c0392b); font-size: 13px; }
  .kn-empty, .kn-summary { color: var(--text-muted); font-size: 13px; }
  .kn-src-err { color: var(--text-ghost); font-size: 11px; margin-top: 12px; }

  .kn-hits { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .kn-hit { border: 1px solid var(--card-border); padding: 12px; }
  .kn-hit-hd { display: flex; align-items: baseline; gap: 8px; }
  .kn-badge { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 5px; border: 1px solid currentColor; flex-shrink: 0; }
  .kn-badge-files { color: #2a7de1; }
  .kn-badge-research { color: #7a4ec2; }
  .kn-badge-memory { color: #2a9d4a; }
  .kn-badge-datastore { color: var(--accent-ink, #c4570a); }
  .kn-title { font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .kn-score { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); flex-shrink: 0; }
  .kn-passage { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
  .kn-open { display: inline-block; margin-top: 6px; font-family: var(--font-mono); font-size: 10px; color: var(--accent-ink, var(--accent)); text-decoration: none; }
</style>
