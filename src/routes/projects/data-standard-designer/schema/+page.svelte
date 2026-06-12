<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import FieldRow from '../components/FieldRow.svelte';
  import FieldInspector from '../components/FieldInspector.svelte';
  import { templatesForDomain } from '../lib/fieldLibrary';
  import { identifierById } from '../lib/knowledge';
  import { fieldsFromStandard, canIngest } from '../lib/ingest';
  const base = '/projects/data-standard-designer';
  function col(v: number) { return v >= 80 ? 'var(--success)' : v >= 60 ? '#6a8f2d' : v >= 40 ? 'var(--warn)' : 'var(--error)'; }

  // Engine-recommended standards whose fields can be ingested here, on the schema step.
  const recStandards = $derived(app.rec.standards.filter(canIngest).slice(0, 6));
  let ingestMsg = $state('');
  function ingestStd(s: (typeof recStandards)[number]) {
    const n = app.ingestFields(fieldsFromStandard(s));
    ingestMsg = n ? `Added ${n} field${n === 1 ? '' : 's'} from ${s.name}.` : `${s.name}'s fields are already in your schema.`;
  }

  const library = $derived(templatesForDomain(app.brief.domain));
  const selectedField = $derived(app.fields.find((f) => f.id === app.selectedFieldId));
  const usedNames = $derived(new Set(app.fields.map((f) => f.name)));
  const recIdentifierIds = $derived(new Set(app.rec.identifiers.map((i) => i.id)));

  function applyCore() {
    const core = library.filter((t) => t.name === 'record_id' || t.name === 'reference_period' || t.name === 'snapshot_date' || (t.identifier && recIdentifierIds.has(t.identifier)));
    app.applyRecommendedFields(core);
  }
</script>

<div class="dsd-route wide schema">
  <div class="head">
    <div>
      <span class="dsd-eyebrow">Step 02 · The schema</span>
      <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">Shape it. Watch the impact.</h1>
      <p class="dsd-prose">Every change re-scores the design in real time. Reuse a field from the library and the crosswalk grows; add a special-category field and assurance reacts.</p>
    </div>
  </div>

  {#if app.mode === 'analyst'}
    <div class="dsd-note"><span class="tag">Analyst view</span>Each row is one piece of information the dataset will hold. Green-bordered rows are mandatory. The badges <b>PII</b> / <b>SC</b> flag personal and special-category data — they drive the assurance score. Don't worry about the technical detail; switch to <b>Architect</b> mode to control it.</div>
  {/if}

  <div class="grid">
    <div class="editor">
      <div class="toolbar">
        <button class="dsd-btn primary sm" onclick={() => app.addField()}>＋ Add field</button>
        <button class="dsd-btn sm" onclick={applyCore} title="Add the record key, a date and the recommended identifiers">✚ Add recommended core</button>
        <span class="count">{app.fields.length} field{app.fields.length === 1 ? '' : 's'} · {app.fields.filter((f) => f.required).length} mandatory</span>
      </div>

      {#if app.fields.length}
        {#each app.fields as f, i (f.id)}
          <FieldRow field={f} index={i} total={app.fields.length} />
        {/each}
      {:else}
        <div class="empty-state">
          <p>No fields yet.</p>
          <button class="dsd-btn primary" onclick={applyCore}>Start with the recommended core →</button>
        </div>
      {/if}

      {#if library.length}
        <div class="library">
          <span class="dsd-label">Field library — {app.brief.domain} <span class="lib-sub">(reuse a defined field instead of inventing one)</span></span>
          <div class="lib-chips">
            {#each library as t}
              <button class="lib-chip" class:used={usedNames.has(t.name)} disabled={usedNames.has(t.name)} onclick={() => app.addTemplate(t)} title={t.why}>
                {usedNames.has(t.name) ? '✓' : '＋'} {t.title}
                {#if t.sourceStandard}<span class="src">{t.sourceStandard}</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if recStandards.length}
        <div class="rec-standards">
          <span class="dsd-label">Ingest from a recommended standard <span class="lib-sub">(adds its identifiers &amp; key data items as fields)</span></span>
          {#if ingestMsg}<p class="ingest-msg">✓ {ingestMsg}</p>{/if}
          <div class="rs-list">
            {#each recStandards as s}
              <div class="rs-row">
                <button class="rs-name" onclick={() => app.openStandard(s.id)} title="Explore this standard in full">{s.name}<span class="rs-owner">{s.owner}</span></button>
                <button class="dsd-btn sm" onclick={() => ingestStd(s)}>＋ Add fields</button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <aside class="rail">
      <div class="rail-sticky">
        {#if selectedField}
          <FieldInspector field={selectedField} />
        {:else}
        <div class="score-strip">
          <span class="ss-h">Live score — updates as you edit</span>
          <div class="ss-tiles">
            <a class="ss-tile" href={`${base}/interoperability`}><span class="v" style="color:{col(app.interop.value)}">{app.interop.value}</span><span class="l">Interop</span></a>
            <a class="ss-tile" href={`${base}/impact`}><span class="v" style="color:{col(app.assurance.value)}">{app.assurance.value}</span><span class="l">Assurance</span></a>
            <a class="ss-tile" href={`${base}/impact`}><span class="v" style="color:{col(app.adoption.value)}">{app.adoption.value}</span><span class="l">Adoption</span></a>
          </div>
          <a class="ss-open" href={`${base}/interoperability`}>Open Review for the breakdown →</a>
        </div>

        {#if app.rec.identifiers.some((i) => ![...usedNames].some((n) => app.fields.find((f) => f.name === n)?.identifier === i.id))}
          <div class="suggest">
            <span class="dsd-label" style="color:var(--accent)">Identifiers you haven't used yet</span>
            {#each app.rec.identifiers.filter((id) => !app.fields.some((f) => f.identifier === id.id)) as id}
              <button class="sg" onclick={() => app.addField({ name: id.id.replace(/-/g, '_'), title: id.name.replace(/\s*\(.*\)/, ''), type: 'identifier', identifier: id.id, description: id.scope, pii: id.sectors.includes('health') || /pupil|learner|person|child/i.test(id.scope) })}>
                ＋ {id.name.replace(/\s*\(.*\)/, '')}
                <span>{id.caveat ? '⚠ ' : ''}reuse → interoperability</span>
              </button>
            {/each}
          </div>
        {/if}
        {/if}
      </div>
    </aside>
  </div>
</div>

<style>
  .head { margin-bottom: 8px; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 26px; align-items: start; }
  .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .count { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: auto; }
  .empty-state { border: 1.5px dashed var(--card-border); border-radius: var(--radius-round); padding: 30px; text-align: center; }
  .empty-state p { color: var(--text-muted); margin: 0 0 12px; }

  .library { margin-top: 20px; border-top: 1px solid var(--divider); padding-top: 14px; }
  .lib-sub { color: var(--text-ghost); font-weight: 400; text-transform: none; letter-spacing: 0; }
  .lib-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }
  .lib-chip { font-size: 12px; padding: 6px 10px; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); background: var(--surface-elevated); color: var(--text-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .lib-chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .lib-chip.used { opacity: 0.5; cursor: default; }
  .lib-chip .src { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); }

  .rec-standards { margin-top: 20px; border-top: 1px solid var(--divider); padding-top: 14px; }
  .ingest-msg { font-size: 12px; color: var(--success); margin: 6px 0 8px; }
  .rs-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; margin-top: 8px; }
  .rs-row { display: flex; align-items: center; gap: 8px; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 8px 10px; background: var(--surface-elevated); }
  .rs-name { flex: 1; min-width: 0; text-align: left; background: none; border: none; cursor: pointer; display: flex; flex-direction: column; }
  .rs-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .rs-name:hover { color: var(--accent); }
  .rs-owner { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); font-weight: 400; }
  .rs-row .dsd-btn { flex-shrink: 0; }

  .rail-sticky { position: sticky; top: 110px; display: flex; flex-direction: column; gap: 12px; }
  .score-strip { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px; background: var(--card-bg); }
  .ss-h { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); display: block; margin-bottom: 9px; }
  .ss-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
  .ss-tile { text-align: center; border: 1px solid var(--divider); border-radius: var(--radius-round); padding: 8px 4px; background: var(--surface-elevated); }
  .ss-tile:hover { border-color: var(--accent); }
  .ss-tile .v { font-family: var(--font-display); font-size: 24px; line-height: 1; display: block; }
  .ss-tile .l { font-family: var(--font-mono); font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .ss-open { display: block; margin-top: 9px; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); }
  .suggest { border: 1.5px solid var(--accent); border-radius: var(--radius-round); padding: 12px; background: var(--accent-tint-04); }
  .sg { width: 100%; text-align: left; background: transparent; border: none; border-top: 1px solid var(--divider); padding: 7px 0; cursor: pointer; font-size: 12.5px; color: var(--text-primary); }
  .sg:first-of-type { border-top: none; }
  .sg span { display: block; font-size: 10px; color: var(--text-muted); }
  .sg:hover { color: var(--accent); }
  .full { width: 100%; justify-content: center; }

  @media (max-width: 940px) { .grid { grid-template-columns: 1fr; } .rail-sticky { position: static; } }
</style>
