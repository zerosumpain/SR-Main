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

  // The intel-query executor reads only `config.query` today (see
  // src/lib/workflows/nodes/intel-query.ts) and runs template interpolation
  // over `{{input.*}}` before calling buildKnowledgeContext(). We expose a
  // structured editor that always preserves unknown keys via { ...config }
  // so any future executor knobs (resultLimit, entityTypes, minRelevance,
  // includeNotes/Entities) survive round-trips even before they're wired
  // into execute().

  const query = $derived(String(config.query ?? ''));
  const resultLimit = $derived.by(() => {
    const raw = config.resultLimit;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const minRelevance = $derived.by(() => {
    const raw = config.minRelevance;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  });
  const includeEntities = $derived(config.includeEntities !== false);
  const includeNotes = $derived(config.includeNotes !== false);

  // Entity-type filter chips. Stored as `config.entityTypes: string[]`.
  function parseChips(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((v) => String(v)).filter((s) => s.trim());
    if (typeof raw === 'string' && raw.trim()) {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  }
  const entityTypes = $derived(parseChips(config.entityTypes));
  let chipDraft = $state('');

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  function setMany(patch: Record<string, unknown>) {
    onChange({ ...config, ...patch });
  }
  function unset(key: string) {
    const next = { ...config };
    delete next[key];
    onChange(next);
  }

  function addChip() {
    const v = chipDraft.trim();
    if (!v) return;
    if (entityTypes.includes(v)) {
      chipDraft = '';
      return;
    }
    set('entityTypes', [...entityTypes, v]);
    chipDraft = '';
  }
  function removeChip(i: number) {
    const next = entityTypes.slice();
    next.splice(i, 1);
    if (next.length === 0) unset('entityTypes');
    else set('entityTypes', next);
  }
  function onChipKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip();
    } else if (e.key === 'Backspace' && chipDraft === '' && entityTypes.length > 0) {
      e.preventDefault();
      removeChip(entityTypes.length - 1);
    }
  }

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles the "What this does" line so we don't duplicate it here.
  void definition;
</script>

<div class="iq">
  <!-- Query -->
  <section class="iq-sec">
    <header class="iq-sec-hdr">
      <span class="sr-label-tight">Query</span>
      <span class="iq-sec-meta">{query.length} chars</span>
    </header>
    <label class="iq-field">
      <span class="iq-label">Search text</span>
      <TemplatedTextarea
        class="iq-code"
        rows={3}
        spellcheck={false}
        placeholder={`{{input.message}}`}
        value={query}
        upstreamFields={upstreamFields}
        onChange={(v) => set('query', v)}
      />
      <span class="iq-hint">
        What to look up in the intel knowledge graph. Templates supported:
        <code>{`{{input.field}}`}</code>. Empty string falls back to
        <code>{`{{input.message}}`}</code>.
      </span>
    </label>
  </section>

  <!-- Result shaping -->
  <section class="iq-sec">
    <header class="iq-sec-hdr">
      <span class="sr-label-tight">Result shaping</span>
    </header>
    <div class="iq-row">
      <label class="iq-field iq-field-half">
        <span class="iq-label">Result limit</span>
        <input
          type="number"
          min="1"
          max="50"
          step="1"
          placeholder="default (10)"
          value={resultLimit ?? ''}
          oninput={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value.trim();
            if (!raw) { unset('resultLimit'); return; }
            const n = Math.max(1, Math.min(50, Number(raw) || 1));
            set('resultLimit', n);
          }}
        />
        <span class="iq-hint">Max entities + note excerpts to embed in context.</span>
      </label>
      <label class="iq-field iq-field-half">
        <span class="iq-label">Min relevance</span>
        <input
          type="number"
          min="0"
          max="1"
          step="0.05"
          placeholder="default (0.4)"
          value={minRelevance ?? ''}
          oninput={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value.trim();
            if (!raw) { unset('minRelevance'); return; }
            const n = Math.max(0, Math.min(1, Number(raw) || 0));
            set('minRelevance', n);
          }}
        />
        <span class="iq-hint">0–1. Higher = stricter cosine match.</span>
      </label>
    </div>
    <div class="iq-toggles">
      <label class="iq-toggle">
        <input
          type="checkbox"
          checked={includeEntities}
          onchange={(e) => set('includeEntities', (e.currentTarget as HTMLInputElement).checked)}
        />
        <span>Include entities</span>
      </label>
      <label class="iq-toggle">
        <input
          type="checkbox"
          checked={includeNotes}
          onchange={(e) => set('includeNotes', (e.currentTarget as HTMLInputElement).checked)}
        />
        <span>Include note excerpts</span>
      </label>
    </div>
  </section>

  <!-- Advanced filters -->
  <details class="iq-adv">
    <summary><span class="sr-label-tight">Advanced — entity-type filter</span></summary>
    <div class="iq-adv-body">
      <div class="iq-chips">
        {#each entityTypes as t, i (i + ':' + t)}
          <span class="iq-chip">
            <span class="iq-chip-text">{t}</span>
            <button type="button" class="iq-chip-rm" onclick={() => removeChip(i)} aria-label="remove {t}">×</button>
          </span>
        {/each}
        <input
          type="text"
          class="iq-chip-input"
          placeholder={entityTypes.length === 0 ? 'person, project, place… (Enter to add)' : 'add another…'}
          value={chipDraft}
          oninput={(e) => (chipDraft = (e.currentTarget as HTMLInputElement).value)}
          onkeydown={onChipKey}
          onblur={addChip}
        />
      </div>
      <span class="iq-hint">
        Restrict matched entities to these type names. Empty list = all types.
      </span>
    </div>
  </details>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => setMany({ _onError: v })}
  />

  <!-- Advanced raw JSON -->
  <details class="iq-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="iq-code"
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
  .iq { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .iq-sec { display: flex; flex-direction: column; gap: 8px; }
  .iq-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .iq-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .iq-row { display: flex; gap: 10px; }
  .iq-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .iq-field-half { flex: 1; }
  .iq-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .iq-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .iq-hint code, .iq-label code { font-size: var(--fs-label); color: var(--text-muted); }

  .iq-toggles { display: flex; flex-wrap: wrap; gap: 14px; padding-top: 2px; }
  .iq-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: var(--fs-label); color: var(--text-primary);
    cursor: pointer;
  }
  .iq-toggle input { width: auto; margin: 0; }

  .iq-chips {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    padding: 6px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    min-height: 32px;
  }
  .iq-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 4px 2px 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--card-border));
    color: var(--text-primary);
    font-family: var(--font-mono); font-size: var(--fs-label);
  }
  .iq-chip-text { line-height: 1; }
  .iq-chip-rm {
    background: transparent; color: var(--text-muted);
    border: none; padding: 0 4px; cursor: pointer;
    font-size: var(--fs-nav); line-height: 1;
  }
  .iq-chip-rm:hover { color: var(--status-error, #c0392b); }
  .iq-chip-input {
    flex: 1; min-width: 140px;
    padding: 4px 6px;
    background: transparent;
    color: var(--text-primary);
    border: none; outline: none;
    font-family: var(--font-mono); font-size: var(--fs-label);
  }

  .iq-adv, .iq-raw {
    margin-top: 0;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .iq-adv summary, .iq-raw summary { cursor: pointer; }
  .iq-adv-body { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; }

  .iq-code {
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
  .iq-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, textarea:focus { border-color: var(--text-muted); }
</style>
