<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import FieldRow from '../components/FieldRow.svelte';
  import ScoreBar from '../components/ScoreBar.svelte';
  import { templatesForDomain } from '../lib/fieldLibrary';
  import { identifierById } from '../lib/knowledge';
  const base = '/projects/data-standard-designer';

  const library = $derived(templatesForDomain(app.brief.domain));
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
    </div>

    <aside class="rail">
      <div class="rail-sticky">
        <div class="mini-scores">
          <ScoreBar score={app.interop} label="Interoperability" />
          <ScoreBar score={app.assurance} label="Assurance" />
          <ScoreBar score={app.adoption} label="Adoption" />
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

        <a class="dsd-btn dark sm full" href={`${base}/interoperability`}>See the crosswalk →</a>
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

  .rail-sticky { position: sticky; top: 110px; display: flex; flex-direction: column; gap: 12px; }
  .mini-scores { display: flex; flex-direction: column; gap: 8px; }
  .suggest { border: 1.5px solid var(--accent); border-radius: var(--radius-round); padding: 12px; background: var(--accent-tint-04); }
  .sg { width: 100%; text-align: left; background: transparent; border: none; border-top: 1px solid var(--divider); padding: 7px 0; cursor: pointer; font-size: 12.5px; color: var(--text-primary); }
  .sg:first-of-type { border-top: none; }
  .sg span { display: block; font-size: 10px; color: var(--text-muted); }
  .sg:hover { color: var(--accent); }
  .full { width: 100%; justify-content: center; }

  @media (max-width: 940px) { .grid { grid-template-columns: 1fr; } .rail-sticky { position: static; } }
</style>
