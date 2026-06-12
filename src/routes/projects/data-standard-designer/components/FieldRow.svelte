<script lang="ts">
  import type { Field, FieldType } from '../lib/types';
  import { app } from '../lib/appState.svelte';
  import { IDENTIFIERS, CATALOG, identifierById } from '../lib/knowledge';

  let { field, index, total }: { field: Field; index: number; total: number } = $props();

  const TYPES: FieldType[] = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'enum', 'identifier', 'geo', 'currency', 'object', 'array'];
  let open = $state(false);
  const u = (patch: Partial<Field>) => app.updateField(field.id, patch);
  const idCaveat = $derived(field.identifier ? identifierById(field.identifier)?.caveat : undefined);
</script>

<div class="fr" class:req={field.required}>
  <div class="fr-main">
    <button class="fr-grip" title="Reorder" onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button>

    <div class="fr-id">
      <input class="fr-name" value={field.name} oninput={(e) => u({ name: (e.target as HTMLInputElement).value })} placeholder="machine_name" spellcheck="false" />
      <input class="fr-title" value={field.title} oninput={(e) => u({ title: (e.target as HTMLInputElement).value })} placeholder="Human title" />
    </div>

    <select class="fr-type" value={field.type} onchange={(e) => u({ type: (e.target as HTMLSelectElement).value as FieldType })}>
      {#each TYPES as t}<option value={t}>{t}</option>{/each}
    </select>

    <div class="fr-flags">
      <button class="flag" class:on={field.required} title="Mandatory" onclick={() => u({ required: !field.required })}>REQ</button>
      <button class="flag pii" class:on={field.pii} title="Personal data" onclick={() => u({ pii: !field.pii })}>PII</button>
      <button class="flag sc" class:on={field.specialCategory} title="Special-category (Art.9)" onclick={() => u({ specialCategory: !field.specialCategory, pii: field.specialCategory ? field.pii : true })}>SC</button>
    </div>

    <div class="fr-actions">
      <button class="ic" disabled={index === 0} onclick={() => app.moveField(field.id, -1)} title="Move up">↑</button>
      <button class="ic" disabled={index === total - 1} onclick={() => app.moveField(field.id, 1)} title="Move down">↓</button>
      <button class="ic del" onclick={() => app.removeField(field.id)} title="Remove">✕</button>
    </div>
  </div>

  {#if open || app.mode === 'architect'}
    <div class="fr-detail">
      <label class="d">
        <span class="dsd-label">Definition</span>
        <textarea class="dsd-textarea" rows="2" value={field.description} oninput={(e) => u({ description: (e.target as HTMLTextAreaElement).value })} placeholder="What this field means (object class + property + representation)."></textarea>
      </label>
      <div class="d-grid">
        <label>
          <span class="dsd-label">Reuses identifier</span>
          <select class="dsd-select" value={field.identifier || ''} onchange={(e) => u({ identifier: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">— none —</option>
            {#each IDENTIFIERS as id}<option value={id.id}>{id.name}</option>{/each}
          </select>
        </label>
        <label>
          <span class="dsd-label">From standard</span>
          <select class="dsd-select" value={field.sourceStandard || ''} onchange={(e) => u({ sourceStandard: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">— bespoke —</option>
            {#each CATALOG as s}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
        <label>
          <span class="dsd-label">Codelist / vocabulary</span>
          <input class="dsd-input" value={field.codelist || ''} oninput={(e) => u({ codelist: (e.target as HTMLInputElement).value || undefined })} placeholder="e.g. SSDA903 placement codes" />
        </label>
        <label>
          <span class="dsd-label">Format / pattern</span>
          <input class="dsd-input" value={field.format || ''} oninput={(e) => u({ format: (e.target as HTMLInputElement).value || undefined })} placeholder="e.g. ISO 8601, GSS code, regex" />
        </label>
      </div>
      {#if idCaveat}<p class="caveat">⚠ {idCaveat}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .fr { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); background: var(--surface-elevated); margin-bottom: 8px; }
  .fr.req { border-left: 3px solid var(--accent); }
  .fr-main { display: flex; align-items: center; gap: 8px; padding: 7px 9px; flex-wrap: wrap; }
  .fr-grip { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 2px 4px; }
  .fr-id { display: flex; flex-direction: column; gap: 3px; flex: 1 1 200px; min-width: 160px; }
  .fr-name { font-family: var(--font-mono); font-size: 12px; color: var(--accent); background: transparent; border: none; border-bottom: 1px dashed var(--card-border); padding: 1px 0; }
  .fr-title { font-size: 13px; font-weight: 600; color: var(--text-primary); background: transparent; border: none; padding: 1px 0; }
  .fr-name:focus, .fr-title:focus { outline: none; border-bottom: 1px solid var(--accent); }
  .fr-type { font-family: var(--font-mono); font-size: 11px; padding: 4px 6px; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); background: var(--bg); color: var(--text-secondary); }
  .fr-flags { display: inline-flex; gap: 3px; }
  .flag { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.03em; padding: 3px 5px; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); background: transparent; color: var(--text-ghost); cursor: pointer; }
  .flag.on { background: var(--text-primary); color: var(--bg); border-color: var(--text-primary); }
  .flag.pii.on { background: var(--warn); border-color: var(--warn); color: #fff; }
  .flag.sc.on { background: var(--error); border-color: var(--error); color: #fff; }
  .fr-actions { display: inline-flex; gap: 2px; margin-left: auto; }
  .ic { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 3px 5px; border-radius: 3px; }
  .ic:hover:not(:disabled) { background: var(--accent-tint-08); color: var(--accent); }
  .ic:disabled { opacity: 0.3; cursor: default; }
  .ic.del:hover { color: var(--error); background: var(--error-bg); }
  .fr-detail { padding: 4px 12px 12px; border-top: 1px dashed var(--divider); }
  .fr-detail .d { display: block; margin-bottom: 8px; }
  .d-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px 12px; }
  .caveat { font-size: 11.5px; color: var(--warn); background: var(--warn-bg); padding: 6px 9px; border-radius: var(--radius-sharp); margin: 8px 0 0; }
</style>
