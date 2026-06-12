<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { CATALOG, standardById } from '../lib/knowledge';
  import { legalById } from '../lib/legalBasis';
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
  // providers/consumers editors collapse by default to keep the form short
  let providersOpen = $state(false);
  let consumersOpen = $state(false);
  function addCustomPurpose() {
    const v = customPurpose.trim();
    if (v) { app.togglePurpose(v); customPurpose = ''; }
  }

  // --- LLM assistant: natural-language define / revise ---
  let aiOpen = $state(false);
  let aiPrompt = $state('');
  let aiBusy = $state(false);
  let aiError = $state('');
  const hasDesign = $derived(!!app.brief.name || app.fields.length > 0);
  async function callAssist(mode: 'design' | 'revise') {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    aiBusy = true;
    aiError = '';
    try {
      const payload = mode === 'revise'
        ? { mode: 'revise', prompt, design: { brief: app.brief, fields: app.fields } }
        : { mode: 'design', prompt };
      const res = await fetch('/projects/data-standard-designer/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || `Request failed (${res.status})`);
      }
      app.applyAssistantDesign(await res.json());
      aiPrompt = '';
      aiOpen = false;
    } catch (e: any) {
      aiError = e?.message || 'The assistant is unavailable right now.';
    } finally {
      aiBusy = false;
    }
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

      <!-- Natural-language assistant -->
      <div class="ai-panel" class:open={aiOpen}>
        <button class="ai-toggle" onclick={() => (aiOpen = !aiOpen)} aria-expanded={aiOpen}>
          <span class="spark">✦</span>
          {hasDesign ? 'Describe a change in plain English' : 'Describe the dataset — let AI draft a first pass'}
          <span class="chev">{aiOpen ? '▾' : '▸'}</span>
        </button>
        {#if aiOpen}
          <div class="ai-body">
            <textarea
              class="dsd-textarea"
              rows="3"
              bind:value={aiPrompt}
              placeholder={hasDesign
                ? 'e.g. "Add a field for the social worker\'s team, make NHS number mandatory, and add a monthly review date."'
                : 'e.g. "A standard for tracking children in temporary accommodation, shared between housing teams, schools and the local authority, so we can spot kids who keep moving school."'}
            ></textarea>
            <div class="ai-actions">
              {#if hasDesign}
                <button class="dsd-btn primary sm" disabled={aiBusy || !aiPrompt.trim()} onclick={() => callAssist('revise')}>{aiBusy ? 'Working…' : '✦ Revise this design'}</button>
                <button class="dsd-btn sm" disabled={aiBusy || !aiPrompt.trim()} onclick={() => callAssist('design')}>Draft fresh instead</button>
              {:else}
                <button class="dsd-btn primary sm" disabled={aiBusy || !aiPrompt.trim()} onclick={() => callAssist('design')}>{aiBusy ? 'Drafting…' : '✦ Draft the standard'}</button>
              {/if}
              <span class="ai-note">AI proposes a starting point — every field stays fully editable.</span>
            </div>
            {#if aiError}<p class="ai-error">⚠ {aiError}</p>{/if}
          </div>
        {/if}
      </div>

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
          <div class="legal-block">
            <div class="lb-head">
              <span class="dsd-label" style="margin:0">Legal basis to share</span>
              <a class="dsd-btn sm" href={`${base}/legal`}>⚖ Choose from the registry →</a>
            </div>
            {#if app.brief.legalBasisIds.length}
              <div class="lb-chips">
                {#each app.brief.legalBasisIds as id}{@const n = legalById(id)}{#if n}<button class="lb-chip {n.layer}" onclick={() => app.toggleLegalBasis(id)} title="Remove">{n.citation || n.label} ✕</button>{/if}{/each}
              </div>
              <div class="lb-check">
                <span class:met={app.legalBasisCheck.hasA}>A · DP basis</span>
                {#if app.brief.containsSpecialCategory || app.brief.aboutChildren}<span class:met={app.legalBasisCheck.hasA9}>A · Art 9 condition</span>{/if}
                <span class:met={app.legalBasisCheck.hasB}>B · power/gateway</span>
                <span class="soft" class:met={app.legalBasisCheck.hasC}>C · governance</span>
              </div>
              {#if !app.legalBasisCheck.hasB}<p class="warnline">⚠ A lawful basis alone doesn't authorise a public body to share — add the specific <b>power/gateway</b> (Layer B) on the registry.</p>{/if}
            {:else}
              <p class="hint">No legal basis chosen yet. Open the registry to pick a data-protection basis, the specific legal power/gateway, and the governance you'll put in place.</p>
            {/if}
            <label style="margin-top:8px"><span class="dsd-label">Further detail (free text)</span>
              <input class="dsd-input" bind:value={app.brief.legalBasis} placeholder="Any specifics not captured above (e.g. a local ISA reference)" /></label>
          </div>
        {/if}
      </section>

      <!-- Providers -->
      <section class="blk">
        <div class="blk-head">
          <button class="blk-toggle" onclick={() => (providersOpen = !providersOpen)} aria-expanded={providersOpen}>
            <span class="caret">{providersOpen ? '▾' : '▸'}</span>
            <span class="dsd-label" style="margin:0">Information providers — upstream</span>
            {#if app.brief.providers.length}<span class="blk-count">{app.brief.providers.length}</span>{/if}
          </button>
          <button class="dsd-btn sm" onclick={() => { providersOpen = true; app.addProvider(); }}>＋ Add provider</button>
        </div>
        {#if !providersOpen}
          {#if app.brief.providers.length}
            <div class="blk-summary">{#each app.brief.providers as p (p.id)}<button class="sum-chip" onclick={() => (providersOpen = true)}>{p.label || 'Unnamed provider'}</button>{/each}</div>
          {:else}
            <p class="empty">No providers yet — expand to add the organisations that will supply this data.</p>
          {/if}
        {:else}
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
        {/if}
      </section>

      <!-- Consumers -->
      <section class="blk">
        <div class="blk-head">
          <button class="blk-toggle" onclick={() => (consumersOpen = !consumersOpen)} aria-expanded={consumersOpen}>
            <span class="caret">{consumersOpen ? '▾' : '▸'}</span>
            <span class="dsd-label" style="margin:0">Information consumers — downstream</span>
            {#if app.brief.consumers.length}<span class="blk-count">{app.brief.consumers.length}</span>{/if}
          </button>
          <button class="dsd-btn sm" onclick={() => { consumersOpen = true; app.addConsumer(); }}>＋ Add consumer</button>
        </div>
        {#if !consumersOpen}
          {#if app.brief.consumers.length}
            <div class="blk-summary">{#each app.brief.consumers as c (c.id)}<button class="sum-chip" onclick={() => (consumersOpen = true)}>{c.label || 'Unnamed consumer'}</button>{/each}</div>
          {:else}
            <p class="empty">No consumers yet — expand to add who relies on this data downstream.</p>
          {/if}
        {:else}
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
        {/if}
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
  .blk-toggle { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; cursor: pointer; padding: 2px 0; }
  .blk-toggle .caret { font-size: 10px; color: var(--text-muted); width: 10px; }
  .blk-toggle:hover .dsd-label { color: var(--text-primary); }
  .blk-count { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); background: var(--surface-overlay); padding: 1px 7px; border-radius: var(--radius-pill); }
  .blk-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .sum-chip { font-size: 12px; padding: 4px 10px; border: 1px solid var(--card-border); border-radius: var(--radius-pill); background: var(--surface-elevated); color: var(--text-secondary); cursor: pointer; }
  .sum-chip:hover { border-color: var(--accent); color: var(--accent); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .hint, .empty { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.45; }
  .empty { font-style: italic; }
  .warnline { font-size: 12px; color: var(--warn); background: var(--warn-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 4px 0 0; }
  .legal-block { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px; background: var(--surface-elevated); margin-top: 10px; }
  .lb-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .lb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .lb-chip { font-family: var(--font-mono); font-size: 10px; padding: 3px 7px; border-radius: var(--radius-sharp); cursor: pointer; border: 1px solid var(--card-border); background: var(--card-bg); color: var(--text-secondary); }
  .lb-chip.data-protection { border-color: var(--info-border); color: var(--info); background: var(--info-bg); }
  .lb-chip.power { border-color: var(--accent-tint-35); color: var(--accent); background: var(--accent-tint-08); }
  .lb-chip.governance { border-color: var(--success-border); color: var(--success); background: var(--success-bg); }
  .lb-check { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; color: var(--text-muted); margin-bottom: 6px; }
  .lb-check span::before { content: '○ '; }
  .lb-check span.met { color: var(--success); font-weight: 600; }
  .lb-check span.met::before { content: '✓ '; }
  .lb-check span.soft { opacity: 0.8; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .add-inline { display: flex; gap: 8px; align-items: center; max-width: 420px; }

  .ai-panel { margin: 16px 0 4px; border: 1.5px solid var(--accent); border-radius: var(--radius-round); background: var(--accent-tint-04); overflow: hidden; }
  .ai-toggle { width: 100%; display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: transparent; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--text-primary); text-align: left; }
  .ai-toggle .spark { color: var(--accent); font-size: 15px; }
  .ai-toggle .chev { margin-left: auto; color: var(--text-muted); }
  .ai-body { padding: 0 14px 14px; }
  .ai-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .ai-note { font-size: 11px; color: var(--text-muted); }
  .ai-error { font-size: 12px; color: var(--error); background: var(--error-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 8px 0 0; }

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
