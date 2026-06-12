<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { CATALOG, standardById } from '../lib/knowledge';
  import type { Sector, ProviderSector, Ownership } from '../lib/types';
  const base = '/projects/data-standard-designer';

  const DOMAINS: { v: Sector; l: string }[] = [
    { v: 'education', l: 'Education' },
    { v: 'childrens-social-care', l: "Children's social care" },
    { v: 'child-protection', l: 'Child protection' },
    { v: 'health', l: 'Health & care' },
    { v: 'local-gov', l: 'Local government' },
    { v: 'cross-gov', l: 'Cross-government' },
    { v: 'employment', l: 'Employment & skills' },
    { v: 'housing', l: 'Housing' },
    { v: 'justice', l: 'Justice' },
  ];
  const PROVIDER_SECTORS: ProviderSector[] = ['schools', 'multi-academy-trusts', 'local-authorities', 'nhs-health', 'early-years', 'further-education', 'higher-education', 'police', 'housing', 'private-providers', 'voluntary-sector', 'central-gov', 'other'];
  const OWNERSHIPS: Ownership[] = ['public', 'private', 'voluntary', 'mixed'];
  const PURPOSES = ['Operational case-working', 'Safeguarding', 'Statistical analysis', 'Service planning', 'Accountability', 'Research', 'Funding', 'Public information', 'Real-time monitoring'];

  let customPurpose = $state('');
  function addCustomPurpose() {
    const v = customPurpose.trim();
    if (v) { app.togglePurpose(v); customPurpose = ''; }
  }

  function addStandardToProvider(pid: string, sid: string) {
    if (!sid) return;
    const p = app.brief.providers.find((x) => x.id === pid);
    if (p && !p.existingStandards.includes(sid)) app.updateProvider(pid, { existingStandards: [...p.existingStandards, sid] });
  }
  function removeStandardFromProvider(pid: string, sid: string) {
    const p = app.brief.providers.find((x) => x.id === pid);
    if (p) app.updateProvider(pid, { existingStandards: p.existingStandards.filter((s) => s !== sid) });
  }
</script>

<div class="dsd-route brief">
  <div class="grid">
    <div class="form">
      <span class="dsd-eyebrow">Step 01 · The brief</span>
      <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">What is this data for?</h1>
      <p class="dsd-prose">Capture the intent and the people around the data first. Everything the engine recommends flows from this.</p>

      {#if app.mode === 'analyst'}
        <div class="dsd-note"><span class="tag">Analyst tip</span>You don't need to know anything about schemas here. Describe the dataset the way you'd explain it to a colleague. The engine turns this into a field-level standard on the next step.</div>
      {/if}

      <!-- Identity -->
      <section class="blk">
        <label><span class="dsd-label">Standard name</span>
          <input class="dsd-input" bind:value={app.brief.name} placeholder="e.g. Early Help Episode Standard" /></label>
        <label><span class="dsd-label">Purpose — what is it for?</span>
          <textarea class="dsd-textarea" rows="3" bind:value={app.brief.purpose} placeholder="One or two sentences on why this dataset needs to exist and what decisions it supports."></textarea></label>
        <div class="two">
          <label><span class="dsd-label">Domain</span>
            <select class="dsd-select" bind:value={app.brief.domain}>{#each DOMAINS as d}<option value={d.v}>{d.l}</option>{/each}</select></label>
          <label><span class="dsd-label">Geographic coverage</span>
            <input class="dsd-input" bind:value={app.brief.geographicCoverage} placeholder="e.g. England — local authority" /></label>
        </div>
      </section>

      <!-- Processing purposes -->
      <section class="blk">
        <span class="dsd-label">What will the data be processed for?</span>
        <div class="chips">
          {#each PURPOSES as p}
            <button class="dsd-chip" class:on={app.brief.processingPurposes.includes(p)} onclick={() => app.togglePurpose(p)}>{p}</button>
          {/each}
          {#each app.brief.processingPurposes.filter((p) => !PURPOSES.includes(p)) as p}
            <button class="dsd-chip on" onclick={() => app.togglePurpose(p)}>{p} ✕</button>
          {/each}
        </div>
        <div class="add-inline">
          <input class="dsd-input" bind:value={customPurpose} placeholder="Add another purpose…" onkeydown={(e) => e.key === 'Enter' && addCustomPurpose()} />
          <button class="dsd-btn sm" onclick={addCustomPurpose}>Add</button>
        </div>
      </section>

      <!-- Characteristics -->
      <section class="blk">
        <span class="dsd-label">Data characteristics</span>
        <div class="chips">
          <button class="dsd-chip" class:on={app.brief.containsPersonalData} onclick={() => (app.brief.containsPersonalData = !app.brief.containsPersonalData)}>Personal data</button>
          <button class="dsd-chip" class:on={app.brief.containsSpecialCategory} onclick={() => (app.brief.containsSpecialCategory = !app.brief.containsSpecialCategory)}>Special-category (Art.9)</button>
          <button class="dsd-chip" class:on={app.brief.aboutChildren} onclick={() => (app.brief.aboutChildren = !app.brief.aboutChildren)}>About children</button>
        </div>
        {#if app.brief.containsPersonalData}
          <label style="margin-top:10px"><span class="dsd-label">Lawful basis (UK GDPR)</span>
            <input class="dsd-input" bind:value={app.brief.legalBasis} placeholder="e.g. Art.6(1)(e) public task; Art.9(2)(g) substantial public interest" /></label>
          {#if (app.brief.containsSpecialCategory || app.brief.aboutChildren)}
            <p class="warnline">⚠ Special-category or children's data — a DPIA is required, and you need an Article 9 condition. Note these in the lawful basis or in Method notes.</p>
          {/if}
        {/if}
      </section>

      <!-- Providers -->
      <section class="blk">
        <div class="blk-head"><span class="dsd-label" style="margin:0">Information providers — upstream</span>
          <button class="dsd-btn sm" onclick={() => app.addProvider()}>＋ Add provider</button></div>
        <p class="hint">Who collects or supplies the data, what sector they're in, and — crucially — any standard they already hold this data in (adoption depends on meeting them there).</p>
        {#each app.brief.providers as p (p.id)}
          <div class="entity">
            <div class="ent-row">
              <input class="dsd-input" value={p.label} oninput={(e) => app.updateProvider(p.id, { label: (e.target as HTMLInputElement).value })} placeholder="Provider name / class" />
              <button class="ic-del" onclick={() => app.removeProvider(p.id)} title="Remove">✕</button>
            </div>
            <div class="ent-grid">
              <select class="dsd-select" value={p.sector} onchange={(e) => app.updateProvider(p.id, { sector: (e.target as HTMLSelectElement).value as ProviderSector })}>{#each PROVIDER_SECTORS as s}<option value={s}>{s}</option>{/each}</select>
              <select class="dsd-select" value={p.ownership} onchange={(e) => app.updateProvider(p.id, { ownership: (e.target as HTMLSelectElement).value as Ownership })}>{#each OWNERSHIPS as o}<option value={o}>{o} sector</option>{/each}</select>
              <select class="dsd-select" value={p.burdenSensitivity} onchange={(e) => app.updateProvider(p.id, { burdenSensitivity: (e.target as HTMLSelectElement).value as 'low' | 'medium' | 'high' })}>
                <option value="low">low burden-sensitivity</option><option value="medium">medium burden-sensitivity</option><option value="high">high burden-sensitivity</option></select>
            </div>
            <input class="dsd-input" value={p.systemsHeld} oninput={(e) => app.updateProvider(p.id, { systemsHeld: (e.target as HTMLInputElement).value })} placeholder="Systems they keep it in (e.g. SIMS / Arbor MIS)" />
            <div class="std-pills">
              {#each p.existingStandards as sid}
                <span class="std-pill">{standardById(sid)?.name || sid}<button onclick={() => removeStandardFromProvider(p.id, sid)}>✕</button></span>
              {/each}
              <select class="add-std" onchange={(e) => { addStandardToProvider(p.id, (e.target as HTMLSelectElement).value); (e.target as HTMLSelectElement).value = ''; }}>
                <option value="">＋ existing standard they hold…</option>
                {#each CATALOG as s}<option value={s.id}>{s.name}</option>{/each}
              </select>
            </div>
          </div>
        {/each}
        {#if !app.brief.providers.length}<p class="empty">No providers yet — add the organisations that will supply this data.</p>{/if}
      </section>

      <!-- Consumers -->
      <section class="blk">
        <div class="blk-head"><span class="dsd-label" style="margin:0">Information consumers — downstream</span>
          <button class="dsd-btn sm" onclick={() => app.addConsumer()}>＋ Add consumer</button></div>
        {#each app.brief.consumers as c (c.id)}
          <div class="entity">
            <div class="ent-row">
              <input class="dsd-input" value={c.label} oninput={(e) => app.updateConsumer(c.id, { label: (e.target as HTMLInputElement).value })} placeholder="Consumer name / class" />
              <button class="ic-del" onclick={() => app.removeConsumer(c.id)} title="Remove">✕</button>
            </div>
            <input class="dsd-input" value={c.use} oninput={(e) => app.updateConsumer(c.id, { use: (e.target as HTMLInputElement).value })} placeholder="What they use it for" />
          </div>
        {/each}
        {#if !app.brief.consumers.length}<p class="empty">No consumers yet — who relies on this data downstream?</p>{/if}
      </section>

      <!-- Interop goal -->
      <section class="blk">
        <span class="dsd-label">How important is interoperability?</span>
        <div class="seg">
          {#each ['low', 'medium', 'high'] as g}
            <button class:on={app.brief.interopGoal === g} onclick={() => (app.brief.interopGoal = g as 'low' | 'medium' | 'high')}>{g}</button>
          {/each}
        </div>
      </section>

      <div class="dsd-cta-row">
        <a class="dsd-btn primary" href={`${base}/schema`}>Build the schema →</a>
      </div>
    </div>

    <!-- Live recommendation rail -->
    <aside class="rail">
      <div class="rail-inner">
        <span class="dsd-label" style="color:var(--accent)">Engine preview — updates live</span>
        <p class="rail-lede">As you describe the data, the engine reaches for the right standards.</p>

        <div class="rail-blk">
          <span class="rb-h">Identifiers to reuse</span>
          {#if app.rec.identifiers.length}
            {#each app.rec.identifiers.slice(0, 4) as id}
              <div class="rb-item"><b>{id.name.replace(/\s*\(.*\)/, '')}</b><span>{id.scope}</span></div>
            {/each}
          {:else}<p class="rb-empty">—</p>{/if}
        </div>

        <div class="rail-blk">
          <span class="rb-h">Standards to align with</span>
          {#each app.rec.standards.slice(0, 4) as s}
            <div class="rb-item"><b>{s.name}</b><span>{s.owner}</span></div>
          {/each}
        </div>

        <div class="rail-blk row3">
          <div><span class="rb-h">Format</span><b>{app.rec.format.value.toUpperCase()}</b></div>
          <div><span class="rb-h">Collection</span><b>{app.rec.collection.value}</b></div>
          <div><span class="rb-h">Frequency</span><b>{app.rec.frequency.value}</b></div>
        </div>
        <a class="rail-next" href={`${base}/schema`}>Take these into the schema →</a>
      </div>
    </aside>
  </div>
</div>

<style>
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 28px; align-items: start; }
  .blk { margin: 22px 0; display: flex; flex-direction: column; gap: 10px; }
  .blk-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .hint, .empty { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.45; }
  .empty { font-style: italic; }
  .warnline { font-size: 12px; color: var(--warn); background: var(--warn-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 4px 0 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .add-inline { display: flex; gap: 8px; align-items: center; max-width: 420px; }

  .entity { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 10px; margin-bottom: 9px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-elevated); }
  .ent-row { display: flex; gap: 6px; }
  .ent-row .dsd-input { flex: 1; }
  .ic-del { background: none; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); color: var(--text-muted); cursor: pointer; padding: 0 9px; }
  .ic-del:hover { color: var(--error); border-color: var(--error); }
  .ent-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 7px; }
  .std-pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .std-pill { font-family: var(--font-mono); font-size: 10px; background: var(--accent-tint-08); color: var(--accent); padding: 3px 4px 3px 8px; border-radius: var(--radius-sharp); display: inline-flex; align-items: center; gap: 5px; }
  .std-pill button { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; font-size: 11px; }
  .add-std { font-family: var(--font-mono); font-size: 11px; padding: 4px 6px; border: 1px dashed var(--card-border); border-radius: var(--radius-sharp); background: transparent; color: var(--text-muted); max-width: 260px; }

  .seg { display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); overflow: hidden; }
  .seg button { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; padding: 7px 18px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); }
  .seg button.on { background: var(--accent); color: #fff; }

  .rail { position: sticky; top: 110px; }
  .rail-inner { border: 1.5px solid var(--text-primary); border-radius: var(--radius-round); padding: 16px; background: var(--card-bg); }
  .rail-lede { font-size: 12px; color: var(--text-muted); line-height: 1.45; margin: 6px 0 14px; }
  .rail-blk { margin-bottom: 14px; }
  .rb-h { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); display: block; margin-bottom: 5px; }
  .rb-item { padding: 5px 0; border-top: 1px solid var(--divider); }
  .rb-item b { font-size: 12.5px; color: var(--text-primary); display: block; line-height: 1.2; }
  .rb-item span { font-size: 10.5px; color: var(--text-muted); }
  .rb-empty { color: var(--text-ghost); margin: 0; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .row3 b { font-family: var(--font-mono); font-size: 12px; color: var(--accent); }
  .rail-next { display: inline-block; margin-top: 6px; font-family: var(--font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); }

  @media (max-width: 940px) { .grid { grid-template-columns: 1fr; } .rail { position: static; } .two, .row3 { grid-template-columns: 1fr 1fr; } }
</style>
