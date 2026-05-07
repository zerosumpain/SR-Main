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
  const mode = $derived(String(config.mode ?? 'active'));
  const expandable = $derived(config.expandable !== false);
  const sendUpstream = $derived(config.sendUpstream === true);
  const exposeOutputs = $derived(config.exposeOutputs !== false);
  const emitSchema = $derived(String(config.emitSchema ?? ''));

  let showRawJson = $state(false);
</script>

<div class="bvp">
  <!-- Build target -->
  <section class="bvp-sec">
    <header class="bvp-sec-hdr">
      <span class="sr-label-tight">Build target</span>
      <span class="bvp-sec-meta">auto-resolved from upstream Builder Pi if connected</span>
    </header>
    <label class="bvp-field">
      <span class="bvp-label">Build ID <span class="bvp-opt">optional override</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'(inherits from upstream pi — leave blank)'}
        value={buildId}
        oninput={(e) => set('buildId', (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  </section>

  <!-- Mode -->
  <section class="bvp-sec">
    <header class="bvp-sec-hdr"><span class="sr-label-tight">Render mode</span></header>
    <div class="bvp-pill-row" role="radiogroup" aria-label="Render mode">
      {#each [
        { v: 'active', l: 'Active', d: 'live iframe; refreshes on stage events' },
        { v: 'passive', l: 'Passive', d: 'snapshot, no auto-refresh' },
      ] as opt (opt.v)}
        <button
          type="button"
          class="bvp-pill"
          class:bvp-pill-active={mode === opt.v}
          role="radio"
          aria-checked={mode === opt.v}
          title={opt.d}
          onclick={() => set('mode', opt.v)}
        >{opt.l}</button>
      {/each}
    </div>
    <span class="bvp-hint">
      {#if mode === 'active'}<strong>Active</strong> — iframe reloads when the build emits a new <code>stage</code> event (e.g. dev-server restart).{/if}
      {#if mode === 'passive'}<strong>Passive</strong> — iframe loads once and stays put; reload manually from the node body.{/if}
    </span>
  </section>

  <!-- Expand + data ports -->
  <section class="bvp-sec">
    <header class="bvp-sec-hdr"><span class="sr-label-tight">Interaction &amp; data</span></header>
    <label class="bvp-checkbox">
      <input
        type="checkbox"
        checked={expandable}
        onchange={(e) => set('expandable', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show expand button — open as full-screen modal</span>
    </label>
    <label class="bvp-checkbox">
      <input
        type="checkbox"
        checked={exposeOutputs}
        onchange={(e) => set('exposeOutputs', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Expose build data on output handle <code>out</code></span>
    </label>
    <label class="bvp-checkbox">
      <input
        type="checkbox"
        checked={sendUpstream}
        onchange={(e) => set('sendUpstream', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Forward upstream <code>data</code> input into the iframe via <code>postMessage</code></span>
    </label>
  </section>

  <!-- Emit schema (data contract injected into the build prompt) -->
  <section class="bvp-sec">
    <header class="bvp-sec-hdr">
      <span class="sr-label-tight">Emit schema</span>
      <span class="bvp-sec-meta">leave blank for verbose default</span>
    </header>
    <label class="bvp-field">
      <textarea
        class="bvp-code"
        rows="6"
        spellcheck="false"
        placeholder={'{ "type": "assignment", "day": "number", "sausage": "string", "darlingtonTempC": "number" }\n\nor freeform:\n  - day (1-31)\n  - sausage variety\n  - Darlington temperature in °C'}
        value={emitSchema}
        oninput={(e) => set('emitSchema', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="bvp-hint">
        When set, this is auto-injected into the build prompt as a non-negotiable data-emission contract: the agent must call <code>window.parent.postMessage(obj, '*')</code> for every relevant event with this shape.
        When blank, the prompt instructs the agent to emit verbosely on its own — include a <code>type</code>, a <code>ts</code>, and anything useful downstream.
        JSON or freeform; the agent reads it as written.
      </span>
    </label>
  </section>

  <!-- Notes -->
  <section class="bvp-sec bvp-sec-quiet">
    <header class="bvp-sec-hdr"><span class="sr-label-tight">Output shape</span></header>
    <p class="bvp-empty">
      Output handle <code>out</code> emits
      <code>{`{ buildId, workflowName, status, publishedSlug, previewUrl, serveConfig, updatedAt, tokensUsed, costUsd, iterationsCompleted, value, receivedCount }`}</code> when the build is queried — useful for downstream nodes capturing the build's deliverables.
      The iframe receives any upstream JSON via <code>window.postMessage(data, '*')</code> when <em>Forward upstream data</em> is on.
    </p>
  </section>

  <!-- Advanced raw JSON -->
  <details class="bvp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="bvp-code"
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
  .bvp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bvp-sec { display: flex; flex-direction: column; gap: 8px; }
  .bvp-sec-quiet { opacity: 0.85; }
  .bvp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bvp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .bvp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bvp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .bvp-opt { color: var(--text-ghost); font-size: 9px; }
  .bvp-hint { font-size: 11px; color: var(--text-ghost); }
  .bvp-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .bvp-empty code, .bvp-hint code, .bvp-checkbox code { font-size: 11px; color: var(--text-muted); }

  .bvp-checkbox {
    display: inline-flex; gap: 8px; align-items: center;
    font-size: 12px; color: var(--text-primary);
  }
  .bvp-checkbox input { accent-color: var(--accent); width: 14px; height: 14px; }

  .bvp-pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .bvp-pill {
    padding: 5px 12px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .bvp-pill:hover { color: var(--text-primary); }
  .bvp-pill-active {
    color: var(--text-primary);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .bvp-code {
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
  .bvp-code:focus { border-color: var(--text-muted); }

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

  .bvp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bvp-raw summary { cursor: pointer; }
</style>
