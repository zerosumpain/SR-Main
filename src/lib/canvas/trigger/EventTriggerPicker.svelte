<script lang="ts">
  // The trigger menu's EVENT section: which platform event starts the workflow,
  // an optional source canvas (workflow.completed only), a payload filter, and
  // the event's example payload so `{{input.event.<key>}}` is discoverable.
  //
  // Fed from $lib/events/catalogue — the list the dispatcher subscribes to and
  // the phone reads — instead of the two <option>s that used to be hard-coded
  // into the canvas page. Fully controlled: every edit goes out through
  // `onChange(key, value)`, the page's own setConfigField.
  import { EVENT_CATALOGUE, canonicalEventType, eventEntry } from '$lib/events/catalogue';
  import type { FilterClause } from '$lib/events/filter';

  let {
    eventType = '',
    sourceWorkflowId = '',
    filter = [],
    peerCanvases = [],
    onChange,
  }: {
    eventType?: string;
    sourceWorkflowId?: string;
    filter?: FilterClause[];
    peerCanvases?: Array<{ workflowId: string; title: string; slug: string }>;
    onChange: (key: string, value: unknown) => void;
  } = $props();

  const MAX_CLAUSES = 5;
  const selected = $derived(canonicalEventType(eventType ?? ''));
  const entry = $derived(eventEntry(selected));
  const keys = $derived(entry ? Object.keys(entry.payloadExample) : []);
  const clauses = $derived(Array.isArray(filter) ? filter : []);
  const example = $derived(entry ? JSON.stringify(entry.payloadExample, null, 2) : '');

  function setClause(i: number, patch: Partial<FilterClause>) {
    onChange('filter', clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function addClause() {
    onChange('filter', [...clauses, { key: keys[0] ?? '', op: 'contains', value: '' }]);
  }
  function removeClause(i: number) {
    onChange('filter', clauses.filter((_, j) => j !== i));
  }
</script>

<section class="nm-sec">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">EVENT</span>
  </div>
  <select
    class="nm-text-input"
    value={selected}
    onchange={(e) => {
      onChange('eventType', (e.target as HTMLSelectElement).value);
      onChange('filter', []);
    }}
  >
    <option value="">— pick an event —</option>
    {#each EVENT_CATALOGUE as ev (ev.type)}
      <option value={ev.type}>{ev.label}</option>
    {/each}
  </select>
  {#if entry}
    <p class="etp-desc">{entry.description} <span class="etp-src">· {entry.source}</span></p>
  {/if}
</section>

{#if selected === 'workflow.completed'}
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">SOURCE CANVAS</span>
      <span class="nm-sec-meta">leave empty to fire on ANY workflow</span>
    </div>
    <select
      class="nm-text-input"
      value={sourceWorkflowId ?? ''}
      onchange={(e) => onChange('sourceWorkflowId', (e.target as HTMLSelectElement).value)}
    >
      <option value="">any canvas</option>
      {#each peerCanvases as c (c.workflowId)}
        <option value={c.workflowId}>{c.title} · /{c.slug}</option>
      {/each}
    </select>
  </section>
{/if}

{#if entry}
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">ONLY WHEN</span>
      <span class="nm-sec-meta">{clauses.length ? 'all must match' : 'every event starts a run'}</span>
    </div>
    {#each clauses as c, i (i)}
      <div class="etp-row">
        <select class="nm-text-input etp-key" value={c.key} onchange={(e) => setClause(i, { key: (e.target as HTMLSelectElement).value })}>
          {#if c.key && !keys.includes(c.key)}<option value={c.key}>{c.key}</option>{/if}
          {#each keys as k (k)}<option value={k}>{k}</option>{/each}
        </select>
        <select class="nm-text-input etp-op" value={c.op} onchange={(e) => setClause(i, { op: (e.target as HTMLSelectElement).value as FilterClause['op'] })}>
          <option value="contains">contains</option>
          <option value="equals">is</option>
        </select>
        <input
          class="nm-text-input etp-val"
          value={c.value}
          placeholder="value"
          oninput={(e) => setClause(i, { value: (e.target as HTMLInputElement).value })}
        />
        <button type="button" class="nm-rowact danger" aria-label="Remove condition" onclick={() => removeClause(i)}>×</button>
      </div>
    {/each}
    {#if clauses.length < MAX_CLAUSES}
      <button type="button" class="nm-btn-ghost" onclick={addClause}>+ condition</button>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">PAYLOAD</span>
      <span class="nm-sec-meta">read it downstream as {'{{input.event.<key>}}'}</span>
    </div>
    <pre class="etp-example">{example}</pre>
  </section>
{/if}

<style>
  .etp-desc { margin: 6px 0 0; font-size: var(--fs-label); color: var(--text-muted); }
  .etp-src { color: var(--text-ghost); }
  .etp-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  .etp-key { flex: 0 1 32%; min-width: 0; }
  .etp-op { flex: 0 0 auto; width: auto; }
  .etp-val { flex: 1 1 auto; min-width: 0; }
  .etp-example {
    margin: 0;
    padding: 8px;
    max-height: 200px;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
