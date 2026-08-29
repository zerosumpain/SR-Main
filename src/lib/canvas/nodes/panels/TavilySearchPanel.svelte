<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';

  let {
    config,
    onChange,
    definition,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    upstreamFields?: string[];
  } = $props();

  // ---------- Field readers ------------------------------------------------
  // The tavily-search executor (src/lib/workflows/nodes/tavily-search.ts) reads:
  //   - query        : string (required, supports {{input.field}} templates)
  //   - searchDepth  : 'basic' | 'advanced' (default 'basic')
  //   - maxResults   : number, clamped to [1, 20] (default 5)
  //   - includeAnswer: boolean (default false)
  //   - topic        : 'general' | 'news' (default 'general')
  //   - days         : number, only honoured when topic = 'news'; 0 disables.
  //
  // The Tavily HTTP client (src/lib/deepdive/tavily.ts) does NOT support
  // include/exclude-domains or a generic time-range dropdown today, so this
  // panel intentionally omits those — see report. Unknown keys are preserved
  // via the spread in `set()` so future fields aren't silently dropped.

  const query = $derived(String(config.query ?? ''));
  const searchDepth = $derived(String(config.searchDepth ?? 'basic'));
  const maxResults = $derived(Number(config.maxResults ?? 5));
  const includeAnswer = $derived(
    config.includeAnswer === true || config.includeAnswer === 'true',
  );
  const topic = $derived(String(config.topic ?? 'general'));
  const days = $derived(Number(config.days ?? 0));

  const queryEmpty = $derived(query.trim().length === 0);

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setMaxResults(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(Math.max(Math.floor(n), 1), 20);
    set('maxResults', clamped);
  }

  function setDays(raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      set('days', 0);
      return;
    }
    const clamped = Math.min(Math.max(Math.floor(n), 0), 30);
    set('days', clamped);
  }

  // Suppress single-line newlines in the textarea so it behaves like an input
  // but still lets us style multi-line wrap nicely for long templates.
  function onQueryKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
    }
  }

  // ---------- Raw JSON -----------------------------------------------------

  let showRawJson = $state(false);

  // `definition` referenced for typings only; the canvas-level header renders
  // the "What this does" preview line.
  void definition;
</script>

<div class="tv">
  <!-- Query -->
  <section class="tv-sec">
    <header class="tv-sec-hdr">
      <span class="sr-label-tight">Search query</span>
      {#if queryEmpty}<span class="tv-warn">required</span>{/if}
    </header>
    <label class="tv-field">
      <span class="tv-label">Query</span>
      <TemplatedTextarea
        class="tv-code tv-query"
        rows={2}
        spellcheck={false}
        placeholder="svelte 5 runes best practices"
        value={query}
        upstreamFields={upstreamFields}
        onKeydown={onQueryKeydown}
        onChange={(v) => set('query', v)}
      />
      <span class="tv-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
    </label>
  </section>

  <!-- Search depth + max results -->
  <section class="tv-sec">
    <div class="tv-row">
      <label class="tv-field tv-field-depth">
        <span class="tv-label">Search depth</span>
        <select
          value={searchDepth}
          onchange={(e) => set('searchDepth', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="basic">Basic (fast, cheap)</option>
          <option value="advanced">Advanced (deeper, slower)</option>
        </select>
      </label>
      <label class="tv-field tv-field-max">
        <span class="tv-label">Max results</span>
        <input
          type="number"
          min="1"
          max="20"
          step="1"
          value={maxResults}
          oninput={(e) => setMaxResults((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="tv-hint">1–20 (default 5)</span>
      </label>
    </div>
  </section>

  <!-- Topic + recency -->
  <section class="tv-sec">
    <div class="tv-row">
      <label class="tv-field tv-field-topic">
        <span class="tv-label">Topic</span>
        <select
          value={topic}
          onchange={(e) => set('topic', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="general">General</option>
          <option value="news">News</option>
        </select>
      </label>
      <label class="tv-field tv-field-days">
        <span class="tv-label">Recency (days)</span>
        <input
          type="number"
          min="0"
          max="30"
          step="1"
          value={days}
          disabled={topic !== 'news'}
          oninput={(e) => setDays((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="tv-hint">
          {#if topic === 'news'}
            0 disables. Limits results to last N days.
          {:else}
            Only applied when Topic = News.
          {/if}
        </span>
      </label>
    </div>
  </section>

  <!-- Include answer toggle -->
  <section class="tv-sec">
    <label class="tv-toggle">
      <input
        type="checkbox"
        checked={includeAnswer}
        onchange={(e) => set('includeAnswer', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="tv-toggle-label">Include AI summary answer</span>
    </label>
    <span class="tv-hint">
      Returns a Tavily-generated summary alongside the results (slightly slower).
    </span>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="tv-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="tv-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .tv { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .tv-sec { display: flex; flex-direction: column; gap: 8px; }
  .tv-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .tv-row { display: flex; gap: 10px; }
  .tv-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .tv-field-depth { flex: 1.4; }
  .tv-field-max { flex: 1; }
  .tv-field-topic { flex: 1; }
  .tv-field-days { flex: 1; }

  .tv-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .tv-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .tv-hint code { font-size: var(--fs-label); color: var(--text-muted); }
  .tv-warn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--status-error, #c0392b); }

  .tv-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .tv-code:focus { border-color: var(--text-muted); }
  .tv-query { resize: vertical; min-height: 36px; }

  .tv-toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
  .tv-toggle input[type='checkbox'] { width: auto; margin: 0; }
  .tv-toggle-label { font-size: var(--fs-nav); color: var(--text-primary); }

  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='number']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }
  input[type='number']:disabled { opacity: 0.45; cursor: not-allowed; }

  .tv-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .tv-raw summary { cursor: pointer; }
</style>
