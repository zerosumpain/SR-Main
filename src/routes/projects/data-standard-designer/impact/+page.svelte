<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import ScoreBar from '../components/ScoreBar.svelte';
  const base = '/projects/data-standard-designer';

  const lvl = (v: string) => (v === 'high' ? 'hi' : v === 'medium' ? 'md' : 'lo');
  const availLabel: Record<string, string> = { 'already-held': 'Already held', 'partially-held': 'Partially held', 'new-collection': 'New collection' };

  const held = $derived(app.availabilityRows.filter((a) => a.availability === 'already-held').length);
  const part = $derived(app.availabilityRows.filter((a) => a.availability === 'partially-held').length);
  const neu = $derived(app.availabilityRows.filter((a) => a.availability === 'new-collection').length);
</script>

<div class="dsd-route">
  <span class="dsd-eyebrow">Step 04 · Impact &amp; assurance</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">Who it touches.</h1>
  <p class="dsd-prose">A standard only works if providers can supply it, consumers gain from it, data subjects are protected and it can actually be adopted. This is the impact across all four — live against your current design.</p>

  <div class="scores2">
    <ScoreBar score={app.assurance} label="Assurance" sub="Lawful basis, DPIA, definitions, minimisation" expanded />
    <ScoreBar score={app.adoption} label="Adoption" sub="Reuse, burden, automated collection" expanded />
  </div>

  <h2 class="dsd-h2">Stakeholder impact</h2>
  <div class="table-wrap">
    <table class="mtx">
      <thead><tr><th>Stakeholder</th><th>Role</th><th>Burden</th><th>Value</th><th>Risk</th><th>Note</th></tr></thead>
      <tbody>
        {#each app.stakeholderRows as r}
          <tr>
            <td class="who">{r.stakeholder}</td>
            <td><span class="dsd-pill muted">{r.kind.replace('-', ' ')}</span></td>
            <td><span class="lev {lvl(r.burden)}">{r.burden}</span></td>
            <td><span class="lev {lvl(r.value)}">{r.value}</span></td>
            <td><span class="lev {lvl(r.risk)}">{r.risk}</span></td>
            <td class="note">{r.note}</td>
          </tr>
        {/each}
        {#if !app.stakeholderRows.length}<tr><td colspan="6" class="empty">Add providers and consumers on the <a href={`${base}/brief`}>Brief</a> to see impact.</td></tr>{/if}
      </tbody>
    </table>
  </div>

  <h2 class="dsd-h2">Data availability</h2>
  <p class="dsd-prose">Where each field's data lives today — across public and private sector. Fields already held are reuse; new collection is burden you must justify against the purpose.</p>
  <div class="avail-summary">
    <div class="as-bar">
      {#if app.availabilityRows.length}
        <div class="seg held" style="flex:{held}" title="{held} already held"></div>
        <div class="seg part" style="flex:{part}" title="{part} partially held"></div>
        <div class="seg neu" style="flex:{neu}" title="{neu} new collection"></div>
      {/if}
    </div>
    <div class="as-key"><span><i class="held"></i>{held} already held</span><span><i class="part"></i>{part} partially held</span><span><i class="neu"></i>{neu} new collection</span></div>
  </div>
  <div class="table-wrap">
    <table class="mtx">
      <thead><tr><th>Field</th><th>Availability</th><th>Sector</th><th>Held by</th><th>Note</th></tr></thead>
      <tbody>
        {#each app.availabilityRows as a}
          <tr>
            <td class="who">{a.fieldName}</td>
            <td><span class="avail {a.availability}">{availLabel[a.availability]}</span></td>
            <td><span class="dsd-pill muted">{a.sector}</span></td>
            <td class="note">{a.heldBy}</td>
            <td class="note">{a.note}</td>
          </tr>
        {/each}
        {#if !app.availabilityRows.length}<tr><td colspan="5" class="empty">Add fields on the <a href={`${base}/schema`}>Schema</a> step.</td></tr>{/if}
      </tbody>
    </table>
  </div>

  <h2 class="dsd-h2">Frequency &amp; sympathetic datasets</h2>
  <div class="freq">
    <div class="freq-pick"><span class="fp-l">Recommended cadence</span><b>{app.rec.frequency.value}</b></div>
    <p class="dsd-prose" style="margin:0">{app.rec.frequency.rationale}</p>
    {#if app.rec.frequency.sympathetic.length}
      <div class="symp">{#each app.rec.frequency.sympathetic as s}<span class="dsd-pill">{s}</span>{/each}</div>
    {/if}
  </div>

  <div class="dsd-cta-row"><a class="dsd-btn primary" href={`${base}/publish`}>Publish the standard →</a></div>
</div>

<style>
  .scores2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 18px 0 6px; }
  .table-wrap { overflow-x: auto; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); }
  table.mtx { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 640px; }
  .mtx th { text-align: left; font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); padding: 9px 12px; border-bottom: 1.5px solid var(--card-border); background: var(--card-bg); }
  .mtx td { padding: 9px 12px; border-bottom: 1px solid var(--divider); vertical-align: top; color: var(--text-secondary); }
  .mtx tr:last-child td { border-bottom: none; }
  .who { font-weight: 700; color: var(--text-primary); }
  .note { font-size: 11.5px; color: var(--text-muted); line-height: 1.4; }
  .empty { text-align: center; color: var(--text-muted); font-style: italic; padding: 18px; }
  .empty a, .note a { color: var(--accent); }

  .lev { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-sharp); }
  .lev.lo { background: var(--success-bg); color: var(--success); }
  .lev.md { background: var(--warn-bg); color: var(--warn); }
  .lev.hi { background: var(--error-bg); color: var(--error); }

  .avail { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; padding: 2px 7px; border-radius: var(--radius-sharp); }
  .avail.already-held { background: var(--success-bg); color: var(--success); }
  .avail.partially-held { background: var(--warn-bg); color: var(--warn); }
  .avail.new-collection { background: var(--error-bg); color: var(--error); }

  .avail-summary { margin: 6px 0 14px; }
  .as-bar { display: flex; height: 14px; border-radius: var(--radius-sharp); overflow: hidden; background: var(--surface-overlay); }
  .as-bar .seg.held { background: var(--success); }
  .as-bar .seg.part { background: var(--warn); }
  .as-bar .seg.neu { background: var(--error); }
  .as-key { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 7px; font-size: 11px; color: var(--text-muted); }
  .as-key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .as-key i.held { background: var(--success); } .as-key i.part { background: var(--warn); } .as-key i.neu { background: var(--error); }

  .freq { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 16px; background: var(--card-bg); display: flex; flex-direction: column; gap: 10px; }
  .freq-pick { display: flex; align-items: baseline; gap: 10px; }
  .fp-l { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .freq-pick b { font-family: var(--font-display); font-size: 22px; color: var(--accent); }
  .symp { display: flex; flex-wrap: wrap; gap: 7px; }

  @media (max-width: 800px) { .scores2 { grid-template-columns: 1fr; } }
</style>
