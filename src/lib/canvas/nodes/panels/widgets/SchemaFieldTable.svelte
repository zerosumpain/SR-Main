<script lang="ts">
  // Editable table of schema field rows: {name, type, required?, description?}.
  // Used by Validator (required column on, description off) and FileExtract
  // (description column on, required off). Other adopters can flip either
  // column on without re-implementing the table.
  //
  // The widget always emits rows shaped as the canonical SchemaFieldRow:
  // { name, type, required, description? }. Hidden columns still round-trip
  // through state — required defaults to false when its column is hidden.

  import type { SchemaFieldRow } from '$lib/workflows/types';

  let {
    value,
    onChange,
    includeRequired = true,
    includeDescription = false,
    nameLabel = 'Field name',
    descriptionLabel = 'Description',
    descriptionPlaceholder = '',
    namePlaceholder = '',
    emptyHint = 'No fields. Click "Add field" below.',
  }: {
    value: unknown[] | undefined;
    onChange: (v: SchemaFieldRow[]) => void;
    includeRequired?: boolean;
    includeDescription?: boolean;
    nameLabel?: string;
    descriptionLabel?: string;
    descriptionPlaceholder?: string;
    namePlaceholder?: string;
    emptyHint?: string;
  } = $props();

  const TYPES: SchemaFieldRow['type'][] = ['string', 'number', 'boolean', 'object', 'array'];

  const rows = $derived<SchemaFieldRow[]>(
    Array.isArray(value) ? (value as SchemaFieldRow[]) : [],
  );

  function update(i: number, patch: Partial<SchemaFieldRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    const next: SchemaFieldRow = { name: '', type: 'string', required: false };
    if (includeDescription) next.description = '';
    onChange([...rows, next]);
  }
  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
</script>

<table class="sft">
  <thead>
    <tr>
      <th>{nameLabel}</th>
      <th>Type</th>
      {#if includeRequired}<th>Required</th>{/if}
      {#if includeDescription}<th>{descriptionLabel}</th>{/if}
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row, i (i)}
      <tr>
        <td>
          <input
            type="text"
            placeholder={namePlaceholder}
            value={row.name}
            oninput={(e) => update(i, { name: (e.currentTarget as HTMLInputElement).value })}
          />
        </td>
        <td>
          <select
            value={row.type}
            onchange={(e) => update(i, { type: (e.currentTarget as HTMLSelectElement).value as SchemaFieldRow['type'] })}
          >
            {#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
          </select>
        </td>
        {#if includeRequired}
          <td>
            <input
              type="checkbox"
              checked={row.required}
              onchange={(e) => update(i, { required: (e.currentTarget as HTMLInputElement).checked })}
            />
          </td>
        {/if}
        {#if includeDescription}
          <td>
            <input
              type="text"
              placeholder={descriptionPlaceholder}
              value={row.description ?? ''}
              oninput={(e) => update(i, { description: (e.currentTarget as HTMLInputElement).value })}
            />
          </td>
        {/if}
        <td>
          <button type="button" onclick={() => remove(i)} aria-label="remove">×</button>
        </td>
      </tr>
    {/each}
    {#if rows.length === 0}
      <tr>
        <td
          colspan={2 + (includeRequired ? 1 : 0) + (includeDescription ? 1 : 0) + 1}
          class="sft-empty"
        >{emptyHint}</td>
      </tr>
    {/if}
  </tbody>
</table>
<button type="button" class="sft-add" onclick={add}>+ Add field</button>

<style>
  .sft { width: 100%; border-collapse: collapse; font-size: var(--fs-label); color: var(--text-primary); }
  .sft th, .sft td { padding: 4px 6px; border-bottom: 1px solid var(--card-border); text-align: left; }
  .sft th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .sft input[type='text'], .sft select {
    width: 100%;
    padding: 4px 6px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    outline: none;
  }
  .sft-empty { color: var(--text-ghost); text-align: center; font-style: italic; padding: 12px 0; }
  .sft-add {
    margin-top: 6px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px dashed var(--card-border);
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .sft-add:hover { color: var(--text-primary); }
  button[aria-label='remove'] { background: none; border: none; font-size: var(--fs-body); cursor: pointer; color: #c44; }
</style>
