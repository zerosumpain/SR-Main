<script lang="ts">
  import type { Field, FieldType } from '../lib/types';
  import { app } from '../lib/appState.svelte';
  import { identifierById, standardById } from '../lib/knowledge';
  import { codelistById } from '../lib/codelists';

  let { field, index, total }: { field: Field; index: number; total: number } = $props();

  const TYPES: FieldType[] = ['string', 'integer', 'number', 'boolean', 'date', 'datetime', 'enum', 'identifier', 'geo', 'currency', 'object', 'array'];
  const u = (patch: Partial<Field>) => app.updateField(field.id, patch);
  const selected = $derived(app.selectedFieldId === field.id);

  // Compact provenance summary shown under the main row.
  const idName = $derived(field.identifier ? identifierById(field.identifier)?.name : undefined);
  const stdName = $derived(field.sourceStandard ? standardById(field.sourceStandard)?.name : undefined);
  const clName = $derived(field.codelistId ? codelistById(field.codelistId)?.name : field.codelist);
</script>

<div class="fr" class:req={field.required} class:selected onfocusin={() => app.selectField(field.id)}>
  <div class="fr-main">
    <button class="fr-grip" title="Inspect this field" onclick={() => app.selectField(selected ? null : field.id)}>{selected ? '◉' : '▸'}</button>

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

  <div class="fr-sum">
    {#if idName}<span class="tag id">↔ {idName.replace(/\s*\(.*\)/, '')}</span>{/if}
    {#if stdName}<span class="tag std">⬚ {stdName}</span>{/if}
    {#if clName}<span class="tag cl">≣ {clName}</span>{/if}
    {#if field.description?.trim()}<span class="def">{field.description.trim().slice(0, 80)}</span>{:else if !idName && !stdName && !clName}<button class="inspect-hint" onclick={() => app.selectField(field.id)}>add spec & guidance →</button>{/if}
  </div>
</div>

<style>
  .fr { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); background: var(--surface-elevated); margin-bottom: 8px; }
  .fr.req { border-left: 3px solid var(--accent); }
  .fr.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-tint-14); }
  .fr-main { display: flex; align-items: center; gap: 8px; padding: 7px 9px; flex-wrap: wrap; }
  .fr-grip { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 2px 4px; }
  .fr.selected .fr-grip { color: var(--accent); }
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
  .ic { background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 3px 5px; border-radius: var(--radius-sharp); }
  .ic:hover:not(:disabled) { background: var(--accent-tint-08); color: var(--accent); }
  .ic:disabled { opacity: 0.3; cursor: default; }
  .ic.del:hover { color: var(--error); background: var(--error-bg); }

  .fr-sum { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 9px 8px 30px; }
  .tag { font-family: var(--font-mono); font-size: 9.5px; padding: 2px 6px; border-radius: var(--radius-sharp); }
  .tag.id { background: var(--accent-tint-08); color: var(--accent); }
  .tag.std { background: var(--card-bg); color: var(--text-secondary); border: 1px solid var(--divider); }
  .tag.cl { background: var(--card-bg); color: var(--text-muted); border: 1px solid var(--divider); }
  .def { font-size: 11.5px; color: var(--text-muted); }
  .inspect-hint { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); background: none; border: none; cursor: pointer; padding: 0; }
  .inspect-hint:hover { color: var(--accent); }
</style>
