<script lang="ts">
  // No-code editor for the `switch` node. Replaces the previous fallback where
  // `cases` was a raw JSON `code` textarea ([{ "match": "...", "handle": "..." }])
  // — a hand-authored-JSON wall for a non-developer. Here each case is a row:
  //   when value = [match]  →  handle [handle]
  // The handle names become the node's output ports (via switchHandles(config)
  // in switch.ts), which the user wires to each branch on the canvas.
  import type { PanelProps } from './registry';
  import TemplatedTextarea from './shared/TemplatedTextarea.svelte';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let { config, onChange, upstreamFields = [] }: PanelProps = $props();

  type Case = { match: string; handle: string };

  const expression = $derived(String(config.expression ?? ''));
  const defaultHandle = $derived(String(config.defaultHandle ?? 'default'));
  const cases = $derived(
    Array.isArray(config.cases)
      ? (config.cases as unknown[]).map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return { match: String(o.match ?? ''), handle: String(o.handle ?? '') } as Case;
        })
      : [],
  );

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }
  function setCases(next: Case[]) {
    set('cases', next);
  }
  function updateCase(i: number, patch: Partial<Case>) {
    setCases(cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addCase() {
    setCases([...cases, { match: '', handle: '' }]);
  }
  function removeCase(i: number) {
    setCases(cases.filter((_, idx) => idx !== i));
  }
  // Convenience: if a handle is blank, default it to the match value so the
  // user usually only types once per row.
  function blurHandle(i: number) {
    const c = cases[i];
    if (c && !c.handle.trim() && c.match.trim()) updateCase(i, { handle: c.match.trim() });
  }

  let showRawJson = $state(false);
</script>

<div class="sw">
  <!-- Value to route on -->
  <section class="sw-sec">
    <header class="sw-hd"><span class="sr-label-tight">Route on value</span></header>
    <TemplatedTextarea
      value={expression}
      upstreamFields={upstreamFields}
      placeholder="input.status"
      rows={2}
      onChange={(v) => set('expression', v)}
    />
    <span class="sw-hint">
      The value to branch on — usually an upstream field like <code>input.status</code>.
      (Advanced: any single JS expression.)
    </span>
  </section>

  <!-- Routes -->
  <section class="sw-sec">
    <header class="sw-hd">
      <span class="sr-label-tight">Routes</span>
      <span class="sw-meta">first match wins</span>
    </header>

    {#if cases.length === 0}
      <p class="sw-empty">No routes yet — add one to branch on a value.</p>
    {/if}

    <div class="sw-rows">
      {#each cases as c, i (i)}
        <div class="sw-row">
          <span class="sw-when">when&nbsp;=</span>
          <input
            class="sw-in"
            type="text"
            value={c.match}
            placeholder="paid"
            aria-label="Match value"
            oninput={(e) => updateCase(i, { match: (e.currentTarget as HTMLInputElement).value })}
            onblur={() => blurHandle(i)}
          />
          <span class="sw-arrow">→</span>
          <input
            class="sw-in"
            type="text"
            value={c.handle}
            placeholder="handle name"
            aria-label="Output handle"
            oninput={(e) => updateCase(i, { handle: (e.currentTarget as HTMLInputElement).value })}
          />
          <button class="sw-del" type="button" title="Remove route" aria-label="Remove route" onclick={() => removeCase(i)}>✕</button>
        </div>
      {/each}
    </div>

    <button class="sw-add" type="button" onclick={addCase}>+ Add route</button>
    <span class="sw-hint">
      Each route emits matching input from a named output handle — wire that handle to its branch on the canvas.
    </span>
  </section>

  <!-- Fallback -->
  <section class="sw-sec">
    <header class="sw-hd"><span class="sr-label-tight">Fallback</span></header>
    <label class="sw-field">
      <span class="sw-flabel">Default handle (when nothing matches)</span>
      <input
        class="sw-in"
        type="text"
        value={defaultHandle}
        placeholder="default"
        oninput={(e) => set('defaultHandle', (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  </section>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <details class="sw-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="sw-code"
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
  .sw { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .sw-sec { display: flex; flex-direction: column; gap: 8px; }
  .sw-hd {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .sw-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .sw-hint { font-size: 11px; color: var(--text-ghost); line-height: 1.4; }
  .sw-hint code { font-size: 11px; color: var(--text-muted); }
  .sw-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }

  .sw-rows { display: flex; flex-direction: column; gap: 6px; }
  .sw-row { display: flex; align-items: center; gap: 6px; }
  .sw-when {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted); white-space: nowrap;
  }
  .sw-arrow { color: var(--text-muted); }
  .sw-in {
    flex: 1; min-width: 0;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  .sw-in:focus { border-color: var(--text-muted); }
  .sw-del {
    flex: 0 0 auto;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
  }
  .sw-del:hover { color: var(--status-error, #c0392b); border-color: var(--status-error, #c0392b); }
  .sw-add {
    align-self: flex-start;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .sw-add:hover { color: var(--text-primary); }

  .sw-field { display: flex; flex-direction: column; gap: 4px; }
  .sw-flabel {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .sw-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .sw-raw summary { cursor: pointer; }
  .sw-code {
    width: 100%; margin-top: 8px; padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .sw-code:focus { border-color: var(--text-muted); }
</style>
