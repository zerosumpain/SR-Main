<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESETS } from '../lib/presets';
  import { legalById } from '../lib/legalBasis';
  import ProviderEditor from '../components/ProviderEditor.svelte';
  import type { Sector } from '../lib/types';
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
  const PURPOSES = ['Operational case-working', 'Safeguarding', 'Statistical analysis', 'Service planning', 'Accountability', 'Research', 'Funding', 'Public information', 'Real-time monitoring'];

  let customPurpose = $state('');
  function addCustomPurpose() {
    const v = customPurpose.trim();
    if (v) { app.togglePurpose(v); customPurpose = ''; }
  }

  // Collapsible depth blocks — collapsed by default to keep the brief short.
  let whoOpen = $state(false);
  let legalOpen = $state(false);
  let interopOpen = $state(false);
  let exampleOpen = $state(false);

  function loadExample(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) app.loadDesign(p.build());
    exampleOpen = false;
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
</script>

<div class="dsd-route brief">
  <div class="grid">
    <div class="form">
      <span class="dsd-eyebrow">Step 01 · The brief</span>
      <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">What is this data for?</h1>
      <p class="dsd-prose">Capture the essentials in plain language — the engine turns them into a field-level standard on the next step. Add more context whenever you like; it sharpens the score.</p>

      <!-- On-ramps: AI draft, or start from an example -->
      <div class="onramps">
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
        <div class="ex-wrap">
          <button class="dsd-btn sm" onclick={() => (exampleOpen = !exampleOpen)} aria-expanded={exampleOpen}>Start from an example ▾</button>
          {#if exampleOpen}
            <div class="ex-menu">
              {#each PRESETS as p}
                <button onclick={() => loadExample(p.id)}><b>{p.label}</b><span>{p.domainLabel}</span></button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- ESSENTIALS -->
      <section class="blk">
        <div class="two">
          <label><span class="dsd-label">Standard name</span>
            <input class="dsd-input" bind:value={app.brief.name} placeholder="e.g. Early Help Episode Standard" /></label>
          <label><span class="dsd-label">Domain</span>
            <select class="dsd-select" bind:value={app.brief.domain}>{#each DOMAINS as d}<option value={d.v}>{d.l}</option>{/each}</select></label>
        </div>
        <label><span class="dsd-label">Purpose — what is it for?</span>
          <textarea class="dsd-textarea" rows="2" bind:value={app.brief.purpose} placeholder="One or two sentences on why this dataset needs to exist and what decisions it supports."></textarea></label>

        <span class="dsd-label" style="margin-top:4px">What will the data be processed for?</span>
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

        <span class="dsd-label" style="margin-top:8px">What's in the data?</span>
        <div class="chips">
          <button class="dsd-chip" class:on={app.brief.containsPersonalData} onclick={() => (app.brief.containsPersonalData = !app.brief.containsPersonalData)}>Personal data</button>
          <button class="dsd-chip" class:on={app.brief.containsSpecialCategory} onclick={() => (app.brief.containsSpecialCategory = !app.brief.containsSpecialCategory)}>Special-category (Art.9)</button>
          <button class="dsd-chip" class:on={app.brief.aboutChildren} onclick={() => (app.brief.aboutChildren = !app.brief.aboutChildren)}>About children</button>
        </div>
      </section>

      {#if app.mode === 'analyst'}
        <div class="dsd-note"><span class="tag">Analyst tip</span>That's enough to get a schema. The blocks below are optional — open them to capture who's involved and the legal basis, and watch the score climb.</div>
      {/if}

      <!-- OPTIONAL DEPTH -->
      <section class="depth">
        <!-- Who provides & uses it -->
        <div class="dblk">
          <button class="dblk-head" onclick={() => (whoOpen = !whoOpen)} aria-expanded={whoOpen}>
            <span class="caret">{whoOpen ? '▾' : '▸'}</span>
            <span class="dblk-title">Who provides &amp; uses it</span>
            <span class="dblk-sum">{#if app.brief.providers.length || app.brief.consumers.length}{app.brief.providers.length} provider{app.brief.providers.length === 1 ? '' : 's'} · {app.brief.consumers.length} consumer{app.brief.consumers.length === 1 ? '' : 's'}{:else}<em>optional — improves the adoption score</em>{/if}</span>
          </button>
          {#if whoOpen}
            <div class="dblk-body">
              <div class="sub-head"><span class="dsd-label" style="margin:0">Information providers — upstream</span><button class="dsd-btn sm" onclick={() => app.addProvider()}>＋ Add provider</button></div>
              <p class="hint">Who supplies the data, and — under "add detail" — any standard they already hold it in. Adoption depends on meeting them where they are.</p>
              <ProviderEditor />

              <div class="sub-head" style="margin-top:14px"><span class="dsd-label" style="margin:0">Information consumers — downstream</span><button class="dsd-btn sm" onclick={() => app.addConsumer()}>＋ Add consumer</button></div>
              <div class="cons-list">
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
              </div>
            </div>
          {/if}
        </div>

        <!-- Legal basis -->
        {#if app.brief.containsPersonalData}
          <div class="dblk">
            <button class="dblk-head" onclick={() => (legalOpen = !legalOpen)} aria-expanded={legalOpen}>
              <span class="caret">{legalOpen ? '▾' : '▸'}</span>
              <span class="dblk-title">Legal basis to share</span>
              <span class="dblk-sum">{#if app.brief.legalBasisIds.length}{app.brief.legalBasisIds.length} basis item{app.brief.legalBasisIds.length === 1 ? '' : 's'}{#if !app.legalBasisCheck.hasB} · <span class="warn-text">missing power/gateway</span>{/if}{:else}<em>optional — improves the assurance score</em>{/if}</span>
            </button>
            {#if legalOpen}
              <div class="dblk-body">
                <div class="legal-block">
                  <div class="lb-head">
                    <span class="dsd-label" style="margin:0">Lawful basis + power + governance</span>
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
              </div>
            {/if}
          </div>
        {/if}

        <!-- Interoperability & geography -->
        <div class="dblk">
          <button class="dblk-head" onclick={() => (interopOpen = !interopOpen)} aria-expanded={interopOpen}>
            <span class="caret">{interopOpen ? '▾' : '▸'}</span>
            <span class="dblk-title">Interoperability ambition &amp; geography</span>
            <span class="dblk-sum">{app.brief.interopGoal} interop · {app.brief.geographicCoverage}</span>
          </button>
          {#if interopOpen}
            <div class="dblk-body">
              <span class="dsd-label">How important is interoperability?</span>
              <div class="seg">
                {#each ['low', 'medium', 'high'] as g}
                  <button class:on={app.brief.interopGoal === g} onclick={() => (app.brief.interopGoal = g as 'low' | 'medium' | 'high')}>{g}</button>
                {/each}
              </div>
              <label style="margin-top:10px"><span class="dsd-label">Geographic coverage</span>
                <input class="dsd-input" bind:value={app.brief.geographicCoverage} placeholder="e.g. England — local authority" /></label>
            </div>
          {/if}
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
  .blk { margin: 18px 0; display: flex; flex-direction: column; gap: 10px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .hint, .empty { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.45; }
  .empty { font-style: italic; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .add-inline { display: flex; gap: 8px; align-items: center; max-width: 420px; }

  .onramps { margin: 16px 0 6px; display: flex; flex-direction: column; gap: 8px; }
  .ai-panel { border: 1.5px solid var(--accent); border-radius: var(--radius-round); background: var(--accent-tint-04); overflow: hidden; }
  .ai-toggle { width: 100%; display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: transparent; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--text-primary); text-align: left; }
  .ai-toggle .spark { color: var(--accent); font-size: 15px; }
  .ai-toggle .chev { margin-left: auto; color: var(--text-muted); }
  .ai-body { padding: 0 14px 14px; }
  .ai-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  .ai-note { font-size: 11px; color: var(--text-muted); }
  .ai-error { font-size: 12px; color: var(--error); background: var(--error-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 8px 0 0; }
  .ex-wrap { position: relative; }
  .ex-menu { position: absolute; left: 0; top: calc(100% + 6px); width: 280px; background: var(--surface-elevated); border: 2px solid var(--text-primary); z-index: 20; display: flex; flex-direction: column; }
  .ex-menu button { text-align: left; padding: 9px 12px; background: transparent; border: none; border-bottom: 1px solid var(--divider); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
  .ex-menu button:hover { background: var(--accent-tint-08); }
  .ex-menu b { font-size: 13px; color: var(--text-primary); }
  .ex-menu span { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }

  .depth { display: flex; flex-direction: column; gap: 8px; margin: 14px 0; }
  .dblk { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); overflow: hidden; }
  .dblk-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--card-bg); border: none; cursor: pointer; text-align: left; }
  .dblk-head:hover { background: var(--accent-tint-04); }
  .dblk-head .caret { font-size: 10px; color: var(--text-muted); width: 10px; }
  .dblk-title { font-weight: 700; font-size: 14px; color: var(--text-primary); }
  .dblk-sum { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .dblk-sum em { font-style: normal; color: var(--text-ghost); }
  .dblk-sum .warn-text { color: var(--warn); }
  .dblk-body { padding: 12px 14px 14px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 8px; }
  .sub-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cons-list { display: flex; flex-direction: column; gap: 8px; }
  .entity { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--surface-elevated); }
  .ent-row { display: flex; gap: 6px; }
  .ent-row .dsd-input { flex: 1; }
  .ic-del { background: none; border: 1px solid var(--card-border); border-radius: var(--radius-sharp); color: var(--text-muted); cursor: pointer; padding: 0 9px; }
  .ic-del:hover { color: var(--error); border-color: var(--error); }

  .warnline { font-size: 12px; color: var(--warn); background: var(--warn-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 4px 0 0; }
  .legal-block { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 12px; background: var(--surface-elevated); }
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

  .seg { display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); overflow: hidden; }
  .seg button { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; padding: 7px 18px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); }
  .seg button.on { background: var(--accent); color: #fff; }

  .rail { position: sticky; top: 130px; }
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
