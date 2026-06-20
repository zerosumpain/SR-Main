<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { LEGAL_BASIS, legalById, type LegalNode, type LegalLayer } from '../lib/legalBasis';
  import type { Sector } from '../lib/types';
  const base = '/projects/data-standard-designer';

  let q = $state('');
  let layerFilter = $state<'all' | LegalLayer>('all');
  let domainFilter = $state<'all' | Sector>('all');

  const DOMAINS: (Sector | 'all')[] = ['all', 'education', 'childrens-social-care', 'child-protection', 'health', 'local-gov', 'cross-gov', 'employment', 'justice', 'housing'];
  const NATURE: Record<string, { label: string; cls: string }> = {
    requires: { label: 'duty to share', cls: 'duty' },
    'sets-aside-confidentiality': { label: 'sets aside confidentiality', cls: 'setaside' },
    permits: { label: 'permits sharing', cls: 'permits' },
    condition: { label: 'condition', cls: 'cond' },
    control: { label: 'control', cls: 'ctrl' },
  };

  const selected = $derived(app.brief.legalBasisIds);
  const isSel = (id: string) => selected.includes(id);

  function matchesLeaf(n: LegalNode): boolean {
    if (layerFilter !== 'all' && n.layer !== layerFilter) return false;
    if (domainFilter !== 'all' && n.domains && !n.domains.includes(domainFilter)) return false; // no domains = cross-cutting, always shown
    if (q) {
      const hay = `${n.label} ${n.citation ?? ''} ${n.description ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }
  function prune(nodes: LegalNode[]): LegalNode[] {
    const out: LegalNode[] = [];
    for (const n of nodes) {
      if (n.children && n.children.length) {
        const kids = prune(n.children);
        if (kids.length) out.push({ ...n, children: kids });
      } else if (n.kind && matchesLeaf(n)) {
        out.push(n);
      }
    }
    return out;
  }
  const tree = $derived(prune(LEGAL_BASIS));
  const check = $derived(app.legalBasisCheck);

  // Tree collapse: depth-1+ groups are collapsed by default (calm), expand on
  // click; a search query force-opens everything that matches.
  let expanded = $state<Set<string>>(new Set());
  let allExpanded = $state(false);
  function toggleGroup(id: string) { const s = new Set(expanded); s.has(id) ? s.delete(id) : s.add(id); expanded = s; }
  function countLeaves(n: LegalNode): number { return n.kind ? 1 : (n.children || []).reduce((a, c) => a + countLeaves(c), 0); }
  function groupIds(nodes: LegalNode[], depth = 0, acc: string[] = []): string[] {
    for (const n of nodes) { if (!n.kind && depth >= 1) acc.push(n.id); if (n.children) groupIds(n.children, depth + 1, acc); }
    return acc;
  }
  function toggleAll() { allExpanded = !allExpanded; expanded = allExpanded ? new Set(groupIds(LEGAL_BASIS)) : new Set(); }

  // --- LLM legal-basis adviser: explore the standard, ask questions, recommend ---
  let advOpen = $state(false);
  let advBusy = $state(false);
  let advError = $state('');
  let advStarted = $state(false);
  let advQuestions = $state<any[]>([]);
  let advAnswers = $state<Record<string, string>>({});
  let advRec = $state<any | null>(null);
  const recValidIds = $derived((advRec?.legalBasisIds ?? []).filter((id: string) => legalById(id)));

  function designPayload() {
    const b = app.brief;
    return {
      brief: {
        name: b.name, purpose: b.purpose, domain: b.domain, processingPurposes: b.processingPurposes,
        containsPersonalData: b.containsPersonalData, containsSpecialCategory: b.containsSpecialCategory,
        aboutChildren: b.aboutChildren, geographicCoverage: b.geographicCoverage,
        providers: b.providers.map((p) => ({ label: p.label, sector: p.sector, ownership: p.ownership })),
        consumers: b.consumers.map((c) => ({ label: c.label, use: c.use })),
      },
      fields: app.fields.map((f) => ({ name: f.name, title: f.title, type: f.type, pii: f.pii, specialCategory: f.specialCategory, identifier: f.identifier, codelistId: f.codelistId })),
    };
  }
  async function advise(withAnswers: boolean) {
    advBusy = true; advError = ''; advStarted = true;
    try {
      const answers = withAnswers ? advQuestions.map((q) => ({ q: q.question, a: advAnswers[q.id] || '' })).filter((x) => x.a) : [];
      const res = await fetch(`${base}/assist`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'legal-advise', design: designPayload(), answers }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.message || `Failed (${res.status})`); }
      const j = await res.json();
      advQuestions = Array.isArray(j?.questions) ? j.questions : [];
      advRec = j?.recommendation && Array.isArray(j.recommendation.legalBasisIds) ? j.recommendation : null;
    } catch (e: any) {
      advError = e?.message || 'The adviser is unavailable right now.';
    } finally {
      advBusy = false;
    }
  }
  function applyRec() {
    if (!advRec) return;
    app.brief.legalBasisIds = Array.from(new Set(recValidIds));
  }
</script>

{#snippet renderNode(n: LegalNode, depth: number)}
  {#if n.kind}
    <!-- leaf: a selectable basis -->
    <div class="leaf" class:sel={isSel(n.id)} style="margin-left:{depth * 10}px">
      <button class="use" class:on={isSel(n.id)} onclick={() => app.toggleLegalBasis(n.id)} title={isSel(n.id) ? 'Remove from this standard' : 'Add to this standard'}>{isSel(n.id) ? '✓' : '+'}</button>
      <div class="leaf-body">
        <div class="leaf-head">
          <span class="leaf-label">{n.label}</span>
          {#if n.nature && NATURE[n.nature]}<span class="nat {NATURE[n.nature].cls}">{NATURE[n.nature].label}</span>{/if}
        </div>
        {#if n.citation}<code class="cite">{n.citation}</code>{/if}
        {#if n.description}<p class="leaf-desc">{n.description}</p>{/if}
        {#if n.caveat}<p class="leaf-caveat">⚠ {n.caveat}</p>{/if}
        <div class="leaf-meta">
          {#if n.domains}{#each n.domains as d}<span class="dtag">{d}</span>{/each}{:else}<span class="dtag cross">cross-cutting</span>{/if}
          {#if n.url}<a href={n.url} target="_blank" rel="noopener">source ↗</a>{/if}
        </div>
        {#if n.children}<div class="subleaves">{#each n.children as c}{@render renderNode(c, depth + 1)}{/each}</div>{/if}
      </div>
    </div>
  {:else}
    <!-- group -->
    {@const open = depth === 0 || !!q || expanded.has(n.id)}
    <div class="group" style="margin-left:{depth * 10}px">
      {#if depth === 0}
        <div class="group-head layer"><span class="gl">{n.label}</span></div>
        {#if n.description}<p class="group-desc">{n.description}</p>{/if}
        <div class="group-kids">{#each n.children || [] as c}{@render renderNode(c, depth + 1)}{/each}</div>
      {:else}
        <button class="group-head toggle" onclick={() => toggleGroup(n.id)} aria-expanded={open}>
          <span class="caret">{open ? '▾' : '▸'}</span><span class="gl">{n.label}</span><span class="gcount">{countLeaves(n)}</span>
        </button>
        {#if open}
          {#if n.description}<p class="group-desc">{n.description}</p>{/if}
          <div class="group-kids">{#each n.children || [] as c}{@render renderNode(c, depth + 1)}{/each}</div>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

<div class="dsd-route">
  <span class="dsd-eyebrow">Legal basis registry</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">On what basis can this be shared?</h1>
  <p class="dsd-prose">A hierarchy of the legal bases for sharing government data — from the broad regime down to specific sections and powers across education, health, social care, justice, welfare and the centre. The organising idea is that a <b>complete</b> basis has three layers people routinely conflate:</p>

  <div class="abc">
    <div class="abc-card a"><span class="abc-k">A</span><b>Data-protection lawful basis</b><p>UK GDPR Art 6, plus an Art 9/10 condition for special-category or criminal data. <em>May I process it?</em></p></div>
    <div class="abc-card b"><span class="abc-k">B</span><b>Legal power / gateway</b><p>The statutory function or power that lets — or requires — a public body to share. <em>Am I allowed (or obliged) to share it?</em></p></div>
    <div class="abc-card c"><span class="abc-k">C</span><b>Governance instruments</b><p>DPIA, sharing agreement, CAG/s.251 approval, Appropriate Policy Document. <em>Have I controlled it properly?</em></p></div>
  </div>

  <!-- Completeness against the current brief -->
  <div class="completeness" class:ok={check.complete}>
    <span class="comp-h">Your standard’s legal basis — {selected.length} selected</span>
    <div class="checks">
      <span class="chk" class:met={check.hasA}>{check.hasA ? '✓' : '○'} A · data-protection basis{app.brief.containsPersonalData ? '' : ' (n/a)'}</span>
      <span class="chk" class:met={check.hasA9}>{check.hasA9 ? '✓' : '○'} A · special-category condition{(app.brief.containsSpecialCategory || app.brief.aboutChildren) ? '' : ' (n/a)'}</span>
      <span class="chk" class:met={check.hasB}>{check.hasB ? '✓' : '○'} B · legal power / gateway</span>
      <span class="chk soft" class:met={check.hasC}>{check.hasC ? '✓' : '○'} C · governance (recommended)</span>
    </div>
    {#if selected.length}
      <div class="sel-chips">
        {#each selected as id}{@const n = legalById(id)}{#if n}<button class="sel-chip" onclick={() => app.toggleLegalBasis(id)} title="Remove">{n.label} ✕</button>{/if}{/each}
      </div>
    {/if}
    {#if app.brief.containsPersonalData && !check.hasB}
      <p class="comp-warn">A lawful basis alone doesn’t authorise a public body to share — select the specific <b>power/gateway</b> (Layer B) too.</p>
    {/if}
  </div>

  <!-- LLM adviser -->
  <div class="adviser" class:open={advOpen}>
    <button class="adv-toggle" onclick={() => (advOpen = !advOpen)} aria-expanded={advOpen}>
      <span class="spark">✦</span> Not sure? Let the adviser explore your standard and find the basis
      <span class="chev">{advOpen ? '▾' : '▸'}</span>
    </button>
    {#if advOpen}
      <div class="adv-body">
        <p class="adv-intro">It reads your brief and schema, asks anything it needs to pin down the basis, then recommends a best-fit A+B+C set you can apply in one click.</p>
        {#if !advStarted}
          <button class="dsd-btn primary sm" disabled={advBusy} onclick={() => advise(false)}>{advBusy ? 'Analysing…' : '✦ Analyse my standard'}</button>
        {/if}
        {#if advError}<p class="adv-err">⚠ {advError}</p>{/if}

        {#if advQuestions.length}
          <div class="adv-q">
            <span class="adv-h">A few questions to pin it down</span>
            {#each advQuestions as q}
              <div class="qcard">
                <b>{q.question}</b>
                {#if q.why}<span class="qwhy">{q.why}</span>{/if}
                {#if q.options?.length}
                  <div class="qopts">{#each q.options as o}<button class="qopt" class:on={advAnswers[q.id] === o} onclick={() => (advAnswers[q.id] = o)}>{o}</button>{/each}</div>
                {/if}
                <input class="dsd-input" placeholder="Or type your answer…" value={advAnswers[q.id] || ''} oninput={(e) => (advAnswers[q.id] = (e.target as HTMLInputElement).value)} />
              </div>
            {/each}
            <button class="dsd-btn primary sm" disabled={advBusy} onclick={() => advise(true)}>{advBusy ? 'Thinking…' : 'Get recommendation →'}</button>
          </div>
        {/if}

        {#if advRec}
          <div class="adv-rec">
            <span class="adv-h">Recommended basis {#if advRec.confidence}<span class="conf {advRec.confidence}">{advRec.confidence} confidence</span>{/if}</span>
            {#if advRec.summary}<p class="rec-sum">{advRec.summary}</p>{/if}
            <div class="rec-chips">{#each recValidIds as id}{@const n = legalById(id)}{#if n}<span class="rec-chip {n.layer}">{n.label}</span>{/if}{/each}</div>
            {#if advRec.reasoning?.length}<ul class="rec-reason">{#each advRec.reasoning as r}<li>{r}</li>{/each}</ul>{/if}
            {#if advRec.caveats?.length}<div class="rec-caveats"><b>Watch out</b><ul>{#each advRec.caveats as c}<li>{c}</li>{/each}</ul></div>{/if}
            <div class="rec-actions">
              <button class="dsd-btn primary sm" onclick={applyRec}>✓ Apply these to my standard</button>
              <button class="dsd-btn sm" disabled={advBusy} onclick={() => advise(true)}>Refine</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Filters -->
  <div class="filters">
    <input class="dsd-input search" bind:value={q} placeholder="Search bases, powers, citations…" />
    <select class="dsd-select" bind:value={layerFilter}>
      <option value="all">All layers</option>
      <option value="data-protection">A · Data protection</option>
      <option value="power">B · Powers / gateways</option>
      <option value="governance">C · Governance</option>
    </select>
    <select class="dsd-select" bind:value={domainFilter}>{#each DOMAINS as d}<option value={d}>{d === 'all' ? 'All domains' : d}</option>{/each}</select>
    <button class="dsd-btn sm" onclick={toggleAll}>{allExpanded ? 'Collapse all' : 'Expand all'}</button>
  </div>

  <!-- The hierarchy -->
  <div class="tree">
    {#if tree.length}
      {#each tree as root}{@render renderNode(root, 0)}{/each}
    {:else}
      <p class="empty">No legal bases match those filters.</p>
    {/if}
  </div>

  <div class="dsd-cta-row"><a class="dsd-btn primary" href={`${base}/impact`}>See how this scores →</a><a class="dsd-btn" href={`${base}/brief`}>Back to the brief</a></div>
</div>

<style>
  .abc { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 16px 0 18px; }
  .abc-card { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 14px; background: var(--card-bg); position: relative; }
  .abc-card.a { border-top: 3px solid var(--info); } .abc-card.b { border-top: 3px solid var(--accent); } .abc-card.c { border-top: 3px solid var(--success); }
  .abc-k { font-family: var(--font-display); font-size: 22px; color: var(--text-ghost); position: absolute; top: 10px; right: 12px; }
  .abc-card b { font-size: 14px; color: var(--text-primary); display: block; margin-bottom: 5px; }
  .abc-card p { font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 0; }
  .abc-card em { font-style: italic; color: var(--text-muted); }

  .completeness { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 14px 16px; background: var(--surface-elevated); margin-bottom: 16px; }
  .completeness.ok { border-color: var(--success-border); }
  .comp-h { font-family: var(--font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); display: block; margin-bottom: 8px; }
  .checks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .chk { font-size: 12.5px; color: var(--text-muted); }
  .chk.met { color: var(--success); font-weight: 600; }
  .chk.soft { opacity: 0.85; }
  .sel-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .sel-chip { font-size: 11px; background: var(--accent-tint-08); color: var(--accent); border: 1px solid var(--accent-tint-25); border-radius: var(--radius-sharp); padding: 3px 8px; cursor: pointer; }
  .comp-warn { font-size: 12px; color: var(--warn); background: var(--warn-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 10px 0 0; }

  .adviser { border: 1.5px solid var(--accent); border-radius: var(--radius-round); background: var(--accent-tint-04); margin-bottom: 16px; overflow: hidden; }
  .adv-toggle { width: 100%; display: flex; align-items: center; gap: 9px; padding: 11px 14px; background: transparent; border: none; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--text-primary); text-align: left; }
  .adv-toggle .spark { color: var(--accent); font-size: 15px; } .adv-toggle .chev { margin-left: auto; color: var(--text-muted); }
  .adv-body { padding: 0 14px 14px; }
  .adv-intro { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 0 0 10px; }
  .adv-err { font-size: 12px; color: var(--error); background: var(--error-bg); padding: 7px 10px; border-radius: var(--radius-sharp); }
  .adv-h { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); display: block; margin: 12px 0 8px; }
  .qcard { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 10px 12px; background: var(--surface-elevated); margin-bottom: 8px; }
  .qcard b { font-size: 13px; color: var(--text-primary); display: block; }
  .qwhy { font-size: 11.5px; color: var(--text-muted); display: block; margin: 3px 0 6px; }
  .qopts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
  .qopt { font-size: 11.5px; padding: 4px 10px; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); background: transparent; color: var(--text-secondary); cursor: pointer; }
  .qopt.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .adv-rec { border: 1.5px solid var(--success-border); border-radius: var(--radius-round); padding: 12px 14px; background: var(--success-bg); margin-top: 12px; }
  .conf { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 6px; border-radius: var(--radius-sharp); margin-left: 6px; background: var(--card-bg); color: var(--text-muted); }
  .conf.high { background: var(--success-bg); color: var(--success); } .conf.low { background: var(--warn-bg); color: var(--warn); }
  .rec-sum { font-size: 13px; line-height: 1.55; color: var(--text-primary); margin: 0 0 8px; }
  .rec-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .rec-chip { font-family: var(--font-mono); font-size: 10px; padding: 3px 7px; border-radius: var(--radius-sharp); border: 1px solid var(--card-border); background: var(--card-bg); color: var(--text-secondary); }
  .rec-chip.data-protection { border-color: var(--info-border); color: var(--info); }
  .rec-chip.power { border-color: var(--accent-tint-35); color: var(--accent); }
  .rec-chip.governance { border-color: var(--success-border); color: var(--success); }
  .rec-reason { margin: 6px 0; padding-left: 18px; }
  .rec-reason li { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin-bottom: 3px; }
  .rec-caveats { font-size: 12px; color: var(--text-secondary); margin: 6px 0; }
  .rec-caveats b { color: var(--warn); }
  .rec-caveats ul { margin: 4px 0; padding-left: 18px; }
  .rec-actions { display: flex; gap: 8px; margin-top: 10px; }

  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  .search { flex: 1; min-width: 220px; max-width: 380px; }
  .filters .dsd-select { width: auto; }

  .tree { display: flex; flex-direction: column; gap: 4px; }
  .group { margin-top: 8px; }
  .group-head.layer { margin-top: 14px; }
  .group-head.layer .gl { font-family: var(--font-body); font-weight: 700; font-size: 15px; color: var(--text-primary); }
  .group-head.toggle { width: 100%; display: flex; align-items: center; gap: 8px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 8px 12px; cursor: pointer; text-align: left; }
  .group-head.toggle:hover { border-color: var(--accent); }
  .group-head.toggle .caret { font-size: 10px; color: var(--text-muted); width: 12px; }
  .group-head.toggle .gl { font-family: var(--font-body); font-weight: 600; font-size: 13.5px; color: var(--text-primary); flex: 1; }
  .group-head.toggle .gcount { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); background: var(--surface-overlay); padding: 1px 7px; border-radius: var(--radius-pill); }
  .group-desc { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 4px 0 6px; max-width: 80ch; }
  .group-kids { display: flex; flex-direction: column; gap: 5px; border-left: 2px solid var(--divider); padding-left: 10px; margin-top: 4px; }

  .leaf { display: flex; gap: 9px; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 9px 11px; background: var(--surface-elevated); }
  .leaf.sel { border-color: var(--accent); background: var(--accent-tint-04); }
  .use { flex-shrink: 0; width: 24px; height: 24px; border-radius: var(--radius-pill); border: 1.5px solid var(--card-border); background: transparent; color: var(--text-muted); font-size: 13px; cursor: pointer; line-height: 1; }
  .use.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .leaf-body { min-width: 0; flex: 1; }
  .leaf-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .leaf-label { font-weight: 600; font-size: 13.5px; color: var(--text-primary); }
  .nat { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 6px; border-radius: var(--radius-sharp); }
  .nat.duty { background: var(--error-bg); color: var(--error); }
  .nat.setaside { background: var(--warn-bg); color: var(--warn); }
  .nat.permits { background: var(--info-bg); color: var(--info); }
  .nat.cond { background: var(--accent-tint-08); color: var(--accent); }
  .nat.ctrl { background: var(--success-bg); color: var(--success); }
  .cite { font-family: var(--font-mono); font-size: 10.5px; color: var(--accent); display: inline-block; margin: 3px 0; }
  .leaf-desc { font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: 3px 0; }
  .leaf-caveat { font-size: 11.5px; color: var(--warn); margin: 4px 0 2px; }
  .leaf-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
  .dtag { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); background: var(--card-bg); padding: 1px 5px; border-radius: 2px; }
  .dtag.cross { color: var(--info); }
  .leaf-meta a { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; color: var(--accent); }
  .subleaves { margin-top: 6px; display: flex; flex-direction: column; gap: 5px; border-left: 2px dashed var(--divider); padding-left: 9px; }
  .empty { color: var(--text-muted); font-style: italic; }
</style>
