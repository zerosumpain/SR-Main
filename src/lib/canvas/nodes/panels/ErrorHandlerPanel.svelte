<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // ---------------------------------------------------------------------------
  // ErrorHandlerPanel — config editor for the `error-handler` node TYPE.
  //
  // IMPORTANT: do not confuse two different "on error" concepts:
  //   - The shared <OnErrorBlock> (mounted near the bottom) edits this node's
  //     OWN per-node failure policy at config._onError — i.e. what to do if
  //     the error-handler itself throws while running.
  //   - This panel's main widgets configure the error-handler node TYPE — an
  //     explicit graph node that catches errors flowing in from upstream and
  //     routes them to its `success` or `error` output handle. Those handles
  //     are wired by edges, not by config, so we don't render handle pickers.
  //
  // The current executor (src/lib/workflows/nodes/error-handler.ts) routes
  // automatically based on input shape and does not yet consume any config
  // keys. The widgets below set forward-looking keys under deliberate names;
  // unknown/extra keys are preserved verbatim by spreading `config` on every
  // write so future executor revisions can pick them up without breaking
  // existing graphs.
  // ---------------------------------------------------------------------------

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

  // ---------- Strategy ------------------------------------------------------

  const strategy = $derived(String(config.strategy ?? 'route'));
  const maxRetries = $derived(Number(config.maxRetries ?? 0));
  const retryDelayMs = $derived(Number(config.retryDelayMs ?? 1000));
  const logLevel = $derived(String(config.logLevel ?? 'error'));
  const messageTemplate = $derived(String(config.messageTemplate ?? ''));
  const errorMessageOverride = $derived(String(config.errorMessageOverride ?? ''));
  const captureStatus = $derived(Boolean(config.captureStatus ?? true));
  const captureExplicit = $derived(Boolean(config.captureExplicit ?? true));
  const httpStatusFloor = $derived(Number(config.httpStatusFloor ?? 400));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // ---------- Raw JSON ------------------------------------------------------

  let showRawJson = $state(false);
</script>

<div class="eh">
  <!-- Detection: which input shapes are treated as errors -->
  <section class="eh-sec">
    <header class="eh-sec-hdr">
      <span class="sr-label-tight">Error detection</span>
      <span class="eh-sec-meta">
        {#if captureExplicit && captureStatus}explicit + http{:else if captureExplicit}explicit only{:else if captureStatus}http only{:else}disabled{/if}
      </span>
    </header>
    <label class="eh-check">
      <input
        type="checkbox"
        checked={captureExplicit}
        onchange={(e) => set('captureExplicit', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Treat <code>input.error</code> as an error</span>
    </label>
    <label class="eh-check">
      <input
        type="checkbox"
        checked={captureStatus}
        onchange={(e) => set('captureStatus', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Treat HTTP status &ge; floor as an error</span>
    </label>
    {#if captureStatus}
      <label class="eh-field eh-field-half">
        <span class="eh-label">Status floor</span>
        <input
          type="number" min="100" max="599" step="1"
          value={httpStatusFloor}
          oninput={(e) => set('httpStatusFloor', Math.max(100, Math.min(599, Number((e.currentTarget as HTMLInputElement).value) || 400)))}
        />
      </label>
    {/if}
    <p class="eh-hint">
      Output handles <code>success</code> / <code>error</code> are selected by edges, not config.
    </p>
  </section>

  <!-- Strategy: what to do once an error is detected -->
  <section class="eh-sec">
    <header class="eh-sec-hdr">
      <span class="sr-label-tight">Strategy</span>
      <span class="eh-sec-meta">{
        strategy === 'route' ? 'Route to error handle'
        : strategy === 'retry' ? `Retry ${maxRetries}× then route`
        : strategy === 'log' ? 'Log & continue on success'
        : strategy === 'transform' ? 'Wrap & route'
        : strategy
      }</span>
    </header>
    <label class="eh-field">
      <span class="eh-label">Action</span>
      <select value={strategy} onchange={(e) => set('strategy', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="route">Route to error output (default)</option>
        <option value="retry">Retry upstream then route</option>
        <option value="log">Log error, continue on success</option>
        <option value="transform">Transform error then route</option>
      </select>
    </label>

    {#if strategy === 'retry'}
      <div class="eh-row">
        <label class="eh-field eh-field-half">
          <span class="eh-label">Max retries</span>
          <input
            type="number" min="0" max="20" step="1"
            value={maxRetries}
            oninput={(e) => set('maxRetries', Math.max(0, Math.min(20, Number((e.currentTarget as HTMLInputElement).value) || 0)))}
          />
        </label>
        <label class="eh-field eh-field-half">
          <span class="eh-label">Delay (ms)</span>
          <input
            type="number" min="0" step="100"
            value={retryDelayMs}
            oninput={(e) => set('retryDelayMs', Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))}
          />
        </label>
      </div>
    {/if}

    {#if strategy === 'log'}
      <label class="eh-field">
        <span class="eh-label">Log level</span>
        <select value={logLevel} onchange={(e) => set('logLevel', (e.currentTarget as HTMLSelectElement).value)}>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </label>
    {/if}

    {#if strategy === 'transform'}
      <label class="eh-field">
        <span class="eh-label">Message template</span>
        <textarea
          class="eh-code"
          rows="3"
          spellcheck="false"
          placeholder={`Upstream failed: {{input.error}} (status {{input.status}})`}
          value={messageTemplate}
          oninput={(e) => set('messageTemplate', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="eh-hint">
          Templates: <code>{`{{input.error}}`}</code>, <code>{`{{input.status}}`}</code>. Result is written to <code>output.error</code> on the error branch.
        </span>
      </label>
    {/if}
  </section>

  <!-- Optional: override the synthetic error message used when only HTTP status was seen -->
  <section class="eh-sec">
    <header class="eh-sec-hdr"><span class="sr-label-tight">Synthetic error message</span></header>
    <label class="eh-field">
      <span class="eh-label">Override (when no <code>input.error</code> present)</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`HTTP {{input.status}} from upstream`}
        value={errorMessageOverride}
        oninput={(e) => set('errorMessageOverride', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="eh-hint">Leave blank to use the executor's default (<code>HTTP &lt;status&gt; error</code>).</span>
    </label>
  </section>

  <!-- This node's OWN failure policy (distinct from the node's routing logic) -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON (preserves any unknown keys verbatim) -->
  <details class="eh-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="eh-code"
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
  .eh { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .eh-sec { display: flex; flex-direction: column; gap: 8px; }
  .eh-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .eh-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .eh-row { display: flex; gap: 10px; }
  .eh-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .eh-field-half { flex: 1; }
  .eh-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .eh-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .eh-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 0; }
  .eh-hint code { font-size: var(--fs-label); color: var(--text-muted); }

  .eh-check {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--fs-label); color: var(--text-primary);
    cursor: pointer;
  }
  .eh-check input[type='checkbox'] { width: auto; margin: 0; }
  .eh-check code { font-size: var(--fs-label); color: var(--text-muted); }

  .eh-code {
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
  .eh-code:focus { border-color: var(--text-muted); }

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
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .eh-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .eh-raw summary { cursor: pointer; }
</style>
