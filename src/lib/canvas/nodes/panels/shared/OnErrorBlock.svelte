<script lang="ts">
  // Universal "On failure" block. Stored under config._onError as:
  //   { mode: 'stop' | 'continue' | 'retry' | 'route', retries?: number, retryDelayMs?: number }
  // The workflow engine reads this and wraps node execution accordingly.
  // mode='stop'    → default: throw, mark node failed, stop the run.
  // mode='continue'→ swallow the error, mark node 'completed_with_warning',
  //                  pass an empty output forward.
  // mode='retry'   → retry up to `retries` times with `retryDelayMs` between
  //                  attempts before falling through to stop.
  // mode='route'   → route to the node's `error` outgoing edge if present,
  //                  otherwise fall through to stop.

  let {
    value,
    onChange,
  }: {
    value: Record<string, unknown> | undefined;
    onChange: (v: Record<string, unknown>) => void;
  } = $props();

  const mode = $derived(String((value?.mode as string) ?? 'stop'));
  const retries = $derived(Number(value?.retries ?? 2));
  const retryDelay = $derived(Number(value?.retryDelayMs ?? 1000));

  function set(key: string, v: unknown) {
    const next = { mode, retries, retryDelayMs: retryDelay, ...(value ?? {}), [key]: v };
    onChange(next as Record<string, unknown>);
  }
</script>

<section class="oe">
  <header class="oe-hdr">
    <span class="sr-label-tight">On failure</span>
    <span class="oe-meta">{
      mode === 'stop' ? 'Default: stop the run'
      : mode === 'continue' ? 'Swallow & continue'
      : mode === 'retry' ? `Retry ${retries}× then stop`
      : 'Route to error edge'
    }</span>
  </header>
  <label class="oe-field">
    <span class="oe-label">Behaviour</span>
    <select value={mode} onchange={(e) => set('mode', (e.currentTarget as HTMLSelectElement).value)}>
      <option value="stop">Stop the workflow (default)</option>
      <option value="continue">Continue with empty output</option>
      <option value="retry">Retry, then stop</option>
      <option value="route">Route to error edge</option>
    </select>
  </label>
  {#if mode === 'retry'}
    <div class="oe-row">
      <label class="oe-field oe-field-half">
        <span class="oe-label">Retries</span>
        <input
          type="number" min="1" max="10" step="1"
          value={retries}
          oninput={(e) => set('retries', Math.max(1, Math.min(10, Number((e.currentTarget as HTMLInputElement).value) || 1)))}
        />
      </label>
      <label class="oe-field oe-field-half">
        <span class="oe-label">Delay (ms)</span>
        <input
          type="number" min="0" step="100"
          value={retryDelay}
          oninput={(e) => set('retryDelayMs', Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))}
        />
      </label>
    </div>
  {/if}
</section>

<style>
  .oe {
    display: flex; flex-direction: column; gap: 6px;
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--status-error, #c0392b) 4%, transparent);
    padding: 8px 10px;
  }
  .oe-hdr { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .oe-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .oe-row { display: flex; gap: 8px; }
  .oe-field { display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .oe-field-half { flex: 1; }
  .oe-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  select, input[type='number'] {
    width: 100%; padding: 5px 8px;
    background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); outline: none;
    font: inherit; box-sizing: border-box;
  }
  select:focus, input[type='number']:focus { border-color: var(--text-muted); }
</style>
