<script lang="ts">
  import type { SchemaFieldRow } from '$lib/workflows/types';

  let {
    value,
    onChange,
  }: {
    value: unknown[] | undefined;
    onChange: (v: SchemaFieldRow[]) => void;
  } = $props();

  const rows = $derived<SchemaFieldRow[]>(Array.isArray(value) ? (value as SchemaFieldRow[]) : []);

  const TYPES: SchemaFieldRow['type'][] = ['string', 'number', 'boolean', 'object', 'array'];

  function update(i: number, patch: Partial<SchemaFieldRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }
  function add() {
    onChange([...rows, { name: '', type: 'string', required: false }]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
</script>

<table class="sb">
  <thead>
    <tr><th>Field name</th><th>Type</th><th>Required</th><th></th></tr>
  </thead>
  <tbody>
    {#each rows as row, i (i)}
      <tr>
        <td><input type="text" value={row.name} oninput={(e) => update(i, { name: (e.currentTarget as HTMLInputElement).value })} /></td>
        <td>
          <select value={row.type} onchange={(e) => update(i, { type: (e.currentTarget as HTMLSelectElement).value as SchemaFieldRow['type'] })}>
            {#each TYPES as t}<option value={t}>{t}</option>{/each}
          </select>
        </td>
        <td><input type="checkbox" checked={row.required} onchange={(e) => update(i, { required: (e.currentTarget as HTMLInputElement).checked })} /></td>
        <td><button type="button" onclick={() => remove(i)} aria-label="remove">×</button></td>
      </tr>
    {/each}
    {#if rows.length === 0}
      <tr><td colspan="4" class="sb-empty">No fields. Click "Add field" below.</td></tr>
    {/if}
  </tbody>
</table>
<button type="button" class="sb-add" onclick={add}>+ Add field</button>

<style>
  .sb { width: 100%; border-collapse: collapse; font-size: 12px; color: var(--text-primary); }
  .sb th, .sb td { padding: 4px 6px; border-bottom: 1px solid var(--card-border); text-align: left; }
  .sb th {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .sb input[type='text'], .sb select {
    width: 100%;
    padding: 4px 6px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    outline: none;
  }
  .sb-empty { color: var(--text-ghost); text-align: center; font-style: italic; padding: 12px 0; }
  .sb-add {
    margin-top: 6px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .sb-add:hover { color: var(--text-primary); }
  button[aria-label='remove'] { background: none; border: none; font-size: 16px; cursor: pointer; color: #c44; }
</style>
