<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import UpstreamFieldPicker from './shared/UpstreamFieldPicker.svelte';

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

  // The accumulator executor (src/lib/workflows/nodes/accumulator.ts) reads a
  // single config key:
  //   - collectField: string — dot-key into the input object whose value
  //     should be collected. If empty, the entire input object is collected
  //     as a single item. If the value is an array, its members are spread
  //     into items; otherwise the value is wrapped as a single-item array.
  //
  // We expose `collectField` as a plain text input plus a couple of canned
  // shortcuts for common shapes (root / items / results). Any unknown keys
  // on `config` are preserved verbatim through the spread in `set()`.

  const collectField = $derived(String(config.collectField ?? ''));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function applyShortcut(value: string) {
    set('collectField', value);
  }

  // Live preview of the effective behaviour, mirroring the executor's branch.
  const behaviour = $derived(
    collectField.trim()
      ? `Collect input["${collectField.trim()}"] (array → spread, scalar → wrap, missing → wrap whole input)`
      : 'Collect the entire input object as a single item',
  );

  // Raw JSON disclosure
  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles the "What this does" line so we don't duplicate it inside
  // the panel.
  void definition;
</script>

<div class="acc">
  <!-- Field to collect -->
  <section class="acc-sec">
    <header class="acc-sec-hdr">
      <span class="sr-label-tight">Field to collect</span>
      <span class="acc-sec-meta">{collectField.trim() ? 'field' : 'entire input'}</span>
    </header>
    <label class="acc-field">
      <UpstreamFieldPicker
        label="Input field key"
        value={collectField}
        upstreamFields={upstreamFields}
        placeholder="pick the field to collect"
        allowCustom={true}
        onChange={(v) => set('collectField', v)}
      />
      <span class="acc-hint">
        Top-level key on the input object whose value to accumulate. Leave
        empty to collect the whole input as a single item.
      </span>
    </label>
    <div class="acc-shortcuts">
      <span class="acc-label">Shortcuts</span>
      <button
        type="button"
        class="acc-chip"
        class:acc-chip-on={collectField.trim() === ''}
        onclick={() => applyShortcut('')}
      >entire input</button>
      <button
        type="button"
        class="acc-chip"
        class:acc-chip-on={collectField.trim() === 'items'}
        onclick={() => applyShortcut('items')}
      >items</button>
      <button
        type="button"
        class="acc-chip"
        class:acc-chip-on={collectField.trim() === 'results'}
        onclick={() => applyShortcut('results')}
      >results</button>
      <button
        type="button"
        class="acc-chip"
        class:acc-chip-on={collectField.trim() === 'output'}
        onclick={() => applyShortcut('output')}
      >output</button>
    </div>
    <p class="acc-readout">{behaviour}</p>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="acc-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="acc-code"
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
  .acc { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .acc-sec { display: flex; flex-direction: column; gap: 8px; }
  .acc-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .acc-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .acc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .acc-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .acc-hint { font-size: var(--fs-label); color: var(--text-ghost); }

  .acc-shortcuts {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  }
  .acc-shortcuts .acc-label { margin-right: 4px; }
  .acc-chip {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: lowercase; letter-spacing: 0.04em;
    cursor: pointer;
  }
  .acc-chip:hover { color: var(--text-primary); }
  .acc-chip-on {
    color: var(--accent);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .acc-readout {
    margin: 0;
    font-family: var(--font-mono); font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .acc-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .acc-code:focus { border-color: var(--text-muted); }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }

  .acc-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .acc-raw summary { cursor: pointer; }
</style>
