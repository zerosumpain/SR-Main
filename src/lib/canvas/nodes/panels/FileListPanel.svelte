<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import FilePicker from './shared/FilePicker.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // file-list executor reads `prefix` (LIKE-style match against file name).
  // We expose it here as the directory/path field and round-trip the
  // forward-looking keys (glob, maxResults, recursive, sort) via the spread
  // so unknown keys are preserved and future executor work can pick them up
  // without an editor change.

  const prefix = $derived(String(config.prefix ?? ''));
  const glob = $derived(String(config.glob ?? ''));
  const recursive = $derived(config.recursive !== false); // default true
  const sort = $derived(String(config.sort ?? 'name-asc'));

  const MAX_LIMIT = 1000;
  const rawMax = Number(config.maxResults ?? 100);
  const maxResults = $derived(
    Number.isFinite(rawMax) ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(rawMax))) : 100,
  );

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  function clear(key: string) {
    const next = { ...config };
    delete next[key];
    onChange(next);
  }
  // `definition` only used for typing; canvas page renders any "what this does"
  // header so we deliberately omit a preview block here.
  void definition;
</script>

<div class="fl">
  <!-- Directory / prefix -->
  <section class="fl-sec">
    <header class="fl-sec-hdr"><span class="sr-label-tight">Directory / name prefix</span></header>
    <div class="fl-field">
      <span class="fl-label">Path prefix</span>
      <FilePicker
        value={prefix}
        mode="read"
        placeholder={'logs/ or reports/{{input.date}}/'}
        onChange={(v) => set('prefix', v)}
        hint={`Files whose name starts with this prefix are returned. Browse the file store to inspect existing names, then trim to a directory-style prefix (e.g. 'logs/'). Empty = list everything. Templates supported: {{input.field}}.`}
      />
    </div>
  </section>

  <!-- Glob filter -->
  <section class="fl-sec">
    <header class="fl-sec-hdr">
      <span class="sr-label-tight">Glob filter</span>
      <span class="fl-sec-meta">optional</span>
    </header>
    <label class="fl-field">
      <span class="fl-label">Pattern</span>
      <input
        type="text"
        spellcheck="false"
        value={glob}
        placeholder={'*.csv or **/*.{json,txt}'}
        oninput={(e) => set('glob', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="fl-hint">Applied after the prefix match. Leave blank to keep all matches.</span>
    </label>
  </section>

  <!-- Max results -->
  <section class="fl-sec">
    <header class="fl-sec-hdr">
      <span class="sr-label-tight">Max results</span>
      <span class="fl-sec-meta">{maxResults} / {MAX_LIMIT}</span>
    </header>
    <div class="fl-slider-row">
      <input
        class="fl-slider"
        type="range"
        min="1"
        max={MAX_LIMIT}
        step="1"
        value={maxResults}
        oninput={(e) => set('maxResults', Number((e.currentTarget as HTMLInputElement).value) || 1)}
      />
      <input
        class="fl-slider-num"
        type="number"
        min="1"
        max={MAX_LIMIT}
        step="1"
        value={maxResults}
        oninput={(e) => {
          const n = Number((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(n)) set('maxResults', Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n))));
        }}
      />
    </div>
    <span class="fl-hint">Cap on returned rows. The executor always trims the latest listing to this number.</span>
  </section>

  <!-- Recursive toggle -->
  <section class="fl-sec">
    <header class="fl-sec-hdr"><span class="sr-label-tight">Recursion</span></header>
    <label class="fl-toggle">
      <input
        type="checkbox"
        checked={recursive}
        onchange={(e) => set('recursive', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="fl-toggle-text">
        <strong>Recursive</strong>
        <em>{recursive ? 'descend into sub-paths' : 'top-level only'}</em>
      </span>
    </label>
  </section>

  <!-- Sort -->
  <section class="fl-sec">
    <header class="fl-sec-hdr"><span class="sr-label-tight">Sort order</span></header>
    <div class="fl-row">
      <label class="fl-field">
        <span class="fl-label">Order by</span>
        <select
          value={sort}
          onchange={(e) => set('sort', (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="name-asc">Name (A → Z)</option>
          <option value="name-desc">Name (Z → A)</option>
          <option value="updated-desc">Last updated (newest first)</option>
          <option value="updated-asc">Last updated (oldest first)</option>
          <option value="size-desc">Size (largest first)</option>
          <option value="size-asc">Size (smallest first)</option>
        </select>
      </label>
      {#if sort !== 'name-asc'}
        <button type="button" class="fl-reset" onclick={() => clear('sort')}>reset</button>
      {/if}
    </div>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .fl { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .fl-sec { display: flex; flex-direction: column; gap: 8px; }
  .fl-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .fl-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .fl-row { display: flex; gap: 10px; align-items: flex-end; }
  .fl-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .fl-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .fl-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .fl-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .fl-slider-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 80px;
    gap: 10px;
    align-items: center;
  }
  .fl-slider { width: 100%; }
  .fl-slider-num {
    padding: 5px 7px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
  }
  .fl-slider-num:focus { border-color: var(--text-muted); }

  .fl-toggle {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
  }
  .fl-toggle input[type='checkbox'] { width: 14px; height: 14px; cursor: pointer; }
  .fl-toggle-text { display: flex; flex-direction: column; gap: 2px; line-height: 1.2; }
  .fl-toggle-text strong { font-size: var(--fs-label); color: var(--text-primary); font-weight: 500; }
  .fl-toggle-text em {
    font-style: normal;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted);
  }

  .fl-reset {
    align-self: flex-end;
    padding: 4px 8px;
    background: var(--bg); color: var(--text-muted);
    border: 1px dashed var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .fl-reset:hover { color: var(--text-primary); }

  .fl-code {
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
  .fl-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea, input[type='number'] {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus, input[type='number']:focus {
    border-color: var(--text-muted);
  }
</style>
