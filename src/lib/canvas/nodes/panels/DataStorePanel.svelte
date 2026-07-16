<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import StoreKeyPicker from './shared/StoreKeyPicker.svelte';
  import UpstreamFieldPicker from './shared/UpstreamFieldPicker.svelte';

  let {
    config,
    onChange,
    definition,
    workflowId,
    upstreamFields = [],
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    workflowId?: string;
    upstreamFields?: string[];
  } = $props();

  type Op = 'get' | 'set' | 'append' | 'add_to_set' | 'has' | 'increment' | 'delete';

  const OPS: { value: Op; label: string; hint: string }[] = [
    { value: 'get', label: 'Get', hint: 'Read a stored value. Outputs { value, found }.' },
    { value: 'set', label: 'Set', hint: 'Overwrite the stored value.' },
    { value: 'append', label: 'Append', hint: 'Push a value onto a persistent list (atomic).' },
    { value: 'add_to_set', label: 'Add to set', hint: 'Union a value into a set — no duplicates (atomic).' },
    { value: 'has', label: 'Has', hint: 'Test set membership. Outputs { value: boolean }.' },
    { value: 'increment', label: 'Increment', hint: 'Add to a numeric counter (atomic).' },
    { value: 'delete', label: 'Delete', hint: 'Remove the key.' },
  ];

  // Legacy aliases the executor still absorbs at runtime; normalise on any edit.
  function normaliseOp(raw: unknown): Op {
    const s = String(raw ?? 'get').toLowerCase().trim();
    if (s === 'read') return 'get';
    if (s === 'write') return 'set';
    if (OPS.some((o) => o.value === s)) return s as Op;
    return 'get';
  }

  const operation = $derived(normaliseOp(config.operation));
  const activeHint = $derived(OPS.find((o) => o.value === operation)?.hint ?? '');

  // Write-ish ops may create a new key; read-ish ops pick an existing one.
  const keyMode = $derived<'get' | 'set'>(
    operation === 'get' || operation === 'has' || operation === 'delete' ? 'get' : 'set',
  );

  const showValuePath = $derived(['set', 'append', 'add_to_set', 'has'].includes(operation));
  const showMaxItems = $derived(operation === 'append' || operation === 'add_to_set');

  async function fetchKeys(): Promise<Array<{ key: string; meta?: string }>> {
    if (!workflowId) return [];
    const res = await fetch(`/api/workflows/${workflowId}/data-store`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return (body.keys ?? []) as Array<{ key: string; meta?: string }>;
  }

  function set(patchKey: string, value: unknown) {
    // Always normalise operation alongside whatever is being changed so the
    // first save after loading a legacy 'read'/'write' config writes back the
    // canonical form.
    onChange({ ...config, operation, [patchKey]: value });
  }
  function setOperation(next: Op) {
    onChange({ ...config, operation: next });
  }

  const key = $derived(String(config.key ?? ''));
  const keyMissing = $derived(!key.trim());
  const valuePath = $derived(String(config.valuePath ?? ''));
  const passthrough = $derived(Boolean(config.passthrough));

  let showRawJson = $state(false);
  void definition;
</script>

<div class="ds">
  <!-- Operation -->
  <section class="ds-sec">
    <header class="ds-sec-hdr">
      <span class="sr-label-tight">Operation</span>
    </header>
    <select
      class="ds-select"
      value={operation}
      onchange={(e) => setOperation((e.currentTarget as HTMLSelectElement).value as Op)}
    >
      {#each OPS as o (o.value)}
        <option value={o.value}>{o.label}</option>
      {/each}
    </select>
    <p class="ds-caption">{activeHint}</p>
  </section>

  <!-- Key -->
  <section class="ds-sec">
    <header class="ds-sec-hdr">
      <span class="sr-label-tight">Key</span>
      {#if keyMissing}<span class="ds-warn">⚠ key is required</span>{/if}
    </header>
    <StoreKeyPicker
      value={key}
      mode={keyMode}
      fetcher={fetchKeys}
      onChange={(v) => set('key', v)}
      placeholder={keyMode === 'get' ? 'pick a key' : 'pick existing or create new'}
    />
  </section>

  <!-- Value source -->
  {#if showValuePath}
    <section class="ds-sec">
      <header class="ds-sec-hdr">
        <span class="sr-label-tight">{operation === 'has' ? 'Value to check' : 'Value to store'}</span>
      </header>
      <UpstreamFieldPicker
        label="Value path"
        value={valuePath}
        {upstreamFields}
        placeholder="leave empty for input.value / whole input"
        allowCustom={true}
        onChange={(v) => set('valuePath', v)}
      />
      <p class="ds-hint">
        {#if operation === 'add_to_set'}
          If the value is an array, every element is unioned into the set.
        {:else if operation === 'append'}
          The value is pushed as one element onto the list.
        {:else}
          Dot-path into the input. Empty = <code>input.value</code> or the whole input.
        {/if}
      </p>
    </section>
  {/if}

  <!-- Increment amount -->
  {#if operation === 'increment'}
    <section class="ds-sec">
      <header class="ds-sec-hdr"><span class="sr-label-tight">Amount</span></header>
      <input
        type="number"
        class="ds-num"
        value={String(config.amount ?? '')}
        placeholder="1"
        oninput={(e) => set('amount', (e.currentTarget as HTMLInputElement).value)}
      />
      <p class="ds-hint">How much to add (default 1). Leave empty to use <code>input.value</code>.</p>
    </section>
  {/if}

  <!-- Max items (bounded list / set) -->
  {#if showMaxItems}
    <section class="ds-sec">
      <header class="ds-sec-hdr"><span class="sr-label-tight">Max items</span></header>
      <input
        type="number"
        class="ds-num"
        value={String(config.maxItems ?? '')}
        placeholder="unbounded"
        oninput={(e) => set('maxItems', (e.currentTarget as HTMLInputElement).value)}
      />
      <p class="ds-hint">Keep only the most recent N elements (oldest trimmed). Empty = unbounded.</p>
    </section>
  {/if}

  <!-- Get: default + passthrough -->
  {#if operation === 'get'}
    <section class="ds-sec">
      <header class="ds-sec-hdr"><span class="sr-label-tight">Not-found default</span></header>
      <input
        type="text"
        class="ds-num"
        value={String(config.default ?? '')}
        placeholder="null"
        oninput={(e) => set('default', (e.currentTarget as HTMLInputElement).value)}
      />
      <p class="ds-hint">Returned when the key does not exist.</p>
    </section>
    <section class="ds-sec">
      <label class="ds-toggle-row">
        <input
          type="checkbox"
          checked={passthrough}
          onchange={(e) => set('passthrough', (e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="ds-mode-text">
          <span class="ds-mode-title">Merge into input</span>
          <span class="ds-mode-sub">Output the whole input with the looked-up value merged in — so a Get never drops upstream data.</span>
        </span>
      </label>
      {#if passthrough}
        <label class="ds-field">
          <span class="ds-label">Output key</span>
          <input
            type="text"
            value={String(config.outputKey ?? '')}
            placeholder="value"
            oninput={(e) => set('outputKey', (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      {/if}
    </section>
  {/if}

  <p class="ds-inspect-note">
    Inspect stored entries on the
    <code>workflow_data_store</code> table via pgweb
    (<code>http://homeserv:8085/pgweb/</code>) — entries are scoped by
    <code>(workflowId, key)</code>.
  </p>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <details class="ds-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="ds-code"
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
  .ds { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .ds-sec { display: flex; flex-direction: column; gap: 8px; }
  .ds-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .ds-select {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 13px;
    box-sizing: border-box;
    outline: none;
  }
  .ds-select:focus { border-color: var(--text-muted); }

  .ds-caption {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .ds-caption code { font-size: 11px; color: var(--text-primary); }

  .ds-num {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-family: var(--font-mono);
    font-size: 12px;
    box-sizing: border-box;
    outline: none;
  }
  .ds-num:focus { border-color: var(--text-muted); }

  .ds-toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
  }
  .ds-toggle-row:hover { border-color: var(--text-muted); }
  .ds-toggle-row input[type='checkbox'] { margin-top: 3px; }
  .ds-mode-text { display: flex; flex-direction: column; gap: 2px; }
  .ds-mode-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-primary);
  }
  .ds-mode-sub { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

  .ds-field { display: flex; flex-direction: column; gap: 4px; }
  .ds-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .ds-hint { font-size: 11px; color: var(--text-ghost); margin: 0; line-height: 1.4; }
  .ds-hint code { font-size: 11px; color: var(--text-muted); }

  .ds-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .ds-inspect-note {
    margin: 0;
    font-size: 11px;
    color: var(--text-ghost);
    line-height: 1.5;
    border-left: 2px solid var(--card-border);
    padding: 4px 8px;
  }
  .ds-inspect-note code { font-size: 11px; color: var(--text-muted); }

  .ds-code {
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
  .ds-code:focus { border-color: var(--text-muted); }

  .ds-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .ds-raw summary { cursor: pointer; }

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
