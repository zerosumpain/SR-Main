<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const buildId = $derived(String(config.buildId ?? ''));
  const showThinking = $derived(config.showThinking !== false);
  const showTools = $derived(config.showTools !== false);
  const showLint = $derived(config.showLint !== false);
  const autoScroll = $derived(config.autoScroll !== false);

  let showRawJson = $state(false);
</script>

<div class="bpp">
  <!-- Build target -->
  <section class="bpp-sec">
    <header class="bpp-sec-hdr">
      <span class="sr-label-tight">Build target</span>
      <span class="bpp-sec-meta">auto-resolved from upstream Builder Chat if connected</span>
    </header>
    <label class="bpp-field">
      <span class="bpp-label">Build ID <span class="bpp-opt">optional override</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'(inherits from upstream chat — leave blank)'}
        value={buildId}
        oninput={(e) => set('buildId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="bpp-hint">Set explicitly to attach this Pi to an existing build (skips the upstream chat).</span>
    </label>
  </section>

  <!-- Stream filters -->
  <section class="bpp-sec">
    <header class="bpp-sec-hdr"><span class="sr-label-tight">Stream filters</span></header>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showThinking}
        onchange={(e) => set('showThinking', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[thinks]</code> reasoning</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showTools}
        onchange={(e) => set('showTools', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[tool]</code> / <code>[bash]</code> activity</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showLint}
        onchange={(e) => set('showLint', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[lint]</code> design warnings</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={autoScroll}
        onchange={(e) => set('autoScroll', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Auto-scroll to follow the stream</span>
    </label>
  </section>

  <!-- Notes -->
  <section class="bpp-sec bpp-sec-quiet">
    <header class="bpp-sec-hdr"><span class="sr-label-tight">Behaviour</span></header>
    <p class="bpp-empty">
      Pi exposes a live elapsed timer and an iteration ETA based on past iteration durations.
      The Pause / Stop buttons in the node body are graceful — work-in-progress is preserved (the builder finishes its current tool call before stopping).
      Output handle <code>preview</code> exposes <code>{`{ buildId, status, serveConfig, iterationCount, elapsedMs }`}</code> for downstream Build View nodes or workflow nodes.
    </p>
  </section>

  <!-- Advanced raw JSON -->
  <details class="bpp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="bpp-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .bpp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bpp-sec { display: flex; flex-direction: column; gap: 8px; }
  .bpp-sec-quiet { opacity: 0.85; }
  .bpp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bpp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .bpp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bpp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .bpp-opt { color: var(--text-ghost); font-size: 9px; }
  .bpp-hint { font-size: 11px; color: var(--text-ghost); }
  .bpp-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .bpp-empty code, .bpp-checkbox code { font-size: 11px; color: var(--text-muted); }

  .bpp-checkbox {
    display: inline-flex; gap: 8px; align-items: center;
    font-size: 12px; color: var(--text-primary);
  }
  .bpp-checkbox input { accent-color: var(--accent); width: 14px; height: 14px; }

  .bpp-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .bpp-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .bpp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bpp-raw summary { cursor: pointer; }
</style>
