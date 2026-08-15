<script lang="ts">
  import type { Field } from '../lib/types';
  import { app } from '../lib/appState.svelte';
  import { specForField, publishedFragment } from '../lib/fieldSpec';
  import { IDENTIFIERS, CATALOG } from '../lib/knowledge';
  import { CODELISTS } from '../lib/codelists';

  let { field }: { field: Field } = $props();
  const u = (patch: Partial<Field>) => app.updateField(field.id, patch);

  const spec = $derived(specForField(field));
  const fragment = $derived(publishedFragment(field));
  const enumish = $derived(field.type === 'enum' || field.type === 'array');
  const patternApplied = $derived(!!spec.pattern && field.format === spec.pattern);

  function applyPattern() {
    if (spec.pattern) u({ format: spec.pattern });
  }
</script>

<div class="insp">
  <div class="insp-head">
    <div>
      <span class="ih-lbl">Field spec</span>
      <b class="ih-title">{field.title || field.name || 'Untitled field'}</b>
    </div>
    <button class="ih-close" onclick={() => app.selectField(null)} title="Back to scores">✕</button>
  </div>

  <!-- Definition -->
  <label class="d">
    <span class="dsd-label">Definition</span>
    <textarea class="dsd-textarea" rows="2" value={field.description} oninput={(e) => u({ description: (e.target as HTMLTextAreaElement).value })} placeholder="What this field means (object class + property + representation)."></textarea>
  </label>

  <!-- Specification & guidance -->
  <div class="spec">
    <span class="dsd-label" style="color:var(--accent)">Specification &amp; guidance</span>
    <div class="spec-row"><span class="sk">Format</span><span class="sv">{spec.recommendedFormat}</span></div>
    {#if spec.pattern}
      <div class="spec-row pattern">
        <span class="sk">Pattern</span>
        <code class="rx">{spec.pattern}</code>
        <button class="apply" class:done={patternApplied} disabled={patternApplied} onclick={applyPattern}>{patternApplied ? '✓ applied' : 'apply'}</button>
      </div>
    {/if}
    {#if spec.example}<div class="spec-row"><span class="sk">Example</span><code class="ex">{spec.example}</code></div>{/if}
    <div class="spec-row"><span class="sk">Rule</span><span class="sv rule">{spec.rule}</span></div>
    {#if spec.permissible?.length}
      <div class="perm">
        <span class="sk">Permissible</span>
        <div class="perm-chips">
          {#each spec.permissible.slice(0, 12) as v}<span class="pv"><code>{v.code}</code> {v.label}</span>{/each}
          {#if spec.permissible.length > 12}<span class="pv more">+{spec.permissible.length - 12} more</span>{/if}
        </div>
      </div>
    {/if}
    {#if spec.caveat}<p class="caveat">⚠ {spec.caveat}</p>{/if}
  </div>

  <!-- Provenance & constraints -->
  <div class="prov">
    <div class="p-grid">
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
      {#if enumish}
        <label>
          <span class="dsd-label">Enumerated codelist</span>
          <select class="dsd-select" value={field.codelistId || ''} onchange={(e) => u({ codelistId: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">— pick a codelist —</option>
            {#each CODELISTS as c}<option value={c.id}>{c.name}{c.partial ? ' (subset)' : ''}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        <span class="dsd-label">Format / pattern</span>
        <input class="dsd-input" value={field.format || ''} oninput={(e) => u({ format: (e.target as HTMLInputElement).value || undefined })} placeholder="ISO 8601, a GSS code, or a regex" />
      </label>
    </div>
  </div>

  <!-- Published preview -->
  <div class="pub">
    <span class="dsd-label">Published as → <span class="pub-sub">JSON Schema fragment</span></span>
    <pre>"{field.name || 'field'}": {JSON.stringify(fragment, null, 2)}</pre>
  </div>
</div>

<style>
  .insp { border: 1.5px solid var(--accent); border-radius: var(--radius-sharp); padding: 14px; background: var(--card-bg); display: flex; flex-direction: column; gap: 12px; }
  .insp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .ih-lbl { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); display: block; }
  .ih-title { font-size: var(--fs-body-sm); color: var(--text-primary); line-height: 1.2; }
  .ih-close { background: none; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); color: var(--text-muted); cursor: pointer; padding: 2px 8px; }
  .ih-close:hover { color: var(--accent); border-color: var(--accent); }
  .d { display: block; }

  .spec { border: 1px solid var(--divider); border-radius: var(--radius-sharp); padding: 10px; background: var(--surface-elevated); display: flex; flex-direction: column; gap: 6px; }
  .spec-row { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-label); }
  .sk { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); min-width: 64px; flex-shrink: 0; }
  .sv { color: var(--text-primary); }
  .sv.rule { color: var(--text-secondary); font-size: var(--fs-label-xs); line-height: 1.4; }
  .rx { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); background: var(--bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); padding: 2px 6px; word-break: break-all; flex: 1; }
  .ex { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); }
  .apply { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 8px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-sharp); cursor: pointer; flex-shrink: 0; }
  .apply.done { background: var(--success-bg); color: var(--success); cursor: default; }
  .perm { display: flex; flex-direction: column; gap: 4px; }
  .perm-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .pv { font-size: var(--fs-label-xs); color: var(--text-secondary); background: var(--card-bg); border: 1px solid var(--divider); border-radius: var(--radius-sharp); padding: 2px 6px; }
  .pv code { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); }
  .pv.more { color: var(--text-ghost); font-style: italic; }
  .caveat { font-size: var(--fs-label-xs); color: var(--warn); background: var(--warn-bg); padding: 6px 9px; border-radius: var(--radius-sharp); margin: 2px 0 0; }

  .p-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
  .pub pre { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-secondary); background: var(--bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp); padding: 9px 11px; margin: 4px 0 0; overflow-x: auto; white-space: pre-wrap; }
  .pub-sub { color: var(--text-ghost); font-weight: 400; text-transform: none; letter-spacing: 0; }

  @media (max-width: 480px) { .p-grid { grid-template-columns: 1fr; } }
</style>
