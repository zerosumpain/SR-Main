<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { pct } from '../lib/format';
  import { POSTURE_BY_ID } from '../lib/postures';
  import { CAPABILITY_BY_ID, CAPABILITY_IDS } from '../lib/capabilities';
  import { PRESSURES_BY_ID } from '../lib/pressures';
  import { MATURITY_DIMENSIONS } from '../lib/maturity';
  import { LEGISLATION_BY_ID } from '../lib/legislation';
  import { SOURCES } from '../lib/sources';
  import AlignmentView from '../components/AlignmentView.svelte';
  import CoverageBars from '../components/CoverageBars.svelte';
  import TensionList from '../components/TensionList.svelte';
  import RecommendedFocus from '../components/RecommendedFocus.svelte';
  import LegalPanel from '../components/LegalPanel.svelte';
  import MaturityRadar from '../components/MaturityRadar.svelte';

  function buildBrief(): string {
    const a = app.align;
    const lines: string[] = [];
    lines.push(`# DfE data strategy — diagnostic brief`);
    lines.push(`\n_Strategy: **${app.scenarioName}**. Generated with Keystone (a decision-support tool, not an official strategy)._\n`);
    lines.push(`## Headline\n`);
    lines.push(`- Overall pressure coverage: **${pct(a.overallCoverage)}** (severity-weighted)`);
    lines.push(`- Cross-government: ${pct(a.coverageByOrigin['cross-government'])} · DfE policy: ${pct(a.coverageByOrigin['dfe-policy'])} · Partners: ${pct(a.coverageByOrigin.partners)}`);
    lines.push(`\n## Strategic posture\n`);
    for (const id of Object.keys(app.state.postures)) {
      const v = app.state.postures[id];
      const ax = POSTURE_BY_ID[id];
      if (!ax) continue;
      const lean = Math.abs(v) < 0.12 ? 'balanced' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? ax.leftLabel : ax.rightLabel}`;
      lines.push(`- ${ax.leftLabel} ↔ ${ax.rightLabel}: **${lean}**`);
    }
    lines.push(`\n## Capability investment & strength\n`);
    const total = app.allocTotal || 1;
    for (const id of CAPABILITY_IDS) {
      lines.push(`- ${CAPABILITY_BY_ID[id].name}: ${Math.round(((app.state.allocation[id] ?? 0) / total) * 100)}% of effort → ${pct(a.capability[id] ?? 0)} strength`);
    }
    lines.push(`\n## Tensions flagged (${a.tensions.length})\n`);
    if (!a.tensions.length) lines.push(`- None — the strategy is internally coherent.`);
    for (const t of a.tensions) lines.push(`- **${t.title}** (${t.severity}). ${t.explanation} _Resolve:_ ${t.resolution}`);
    lines.push(`\n## Recommended focus\n`);
    for (const f of a.focus) lines.push(`- [${f.kind}] **${f.title}** — ${f.reason}`);
    lines.push(`\n## Maturity targets\n`);
    for (const d of MATURITY_DIMENSIONS) {
      lines.push(`- ${d.name}: now ${app.state.maturityCurrent[d.id] ?? 2} → target ${app.state.maturityTarget[d.id] ?? 4} (projected ${(a.maturityProjected[d.id] ?? 0).toFixed(1)})`);
    }
    lines.push(`\n## Least-covered pressures\n`);
    const leastCovered = [...Object.entries(a.coverage)].sort((x, y) => x[1] - y[1]).slice(0, 6);
    leastCovered.forEach(([id, c]) => {
      lines.push(`- ${PRESSURES_BY_ID[id]?.title ?? id}: ${pct(c)} covered`);
    });

    // ---- evidence pack: the citations behind the brief ----
    lines.push(`\n## Evidence pack\n`);
    lines.push(`_Every figure above derives from the pressures, frameworks and legal stack below; all are research-backed and cited._\n`);
    if (a.legalImplicated.length) {
      lines.push(`\n### Legislation implicated by this posture`);
      for (const lid of a.legalImplicated) {
        const l = LEGISLATION_BY_ID[lid];
        if (l) lines.push(`- **${l.name}**${l.citation ? ` (${l.citation})` : ''} — ${l.relevance}${l.sourceUrl ? ` [${l.sourceUrl}]` : ''}`);
      }
    }
    // pressures cited: the focus pressures + the least-covered, with their sources
    const citedPressures = [...new Set([...a.focus.filter((f) => f.kind === 'pressure').map((f) => f.id), ...leastCovered.map(([id]) => id)])];
    if (citedPressures.length) {
      lines.push(`\n### Pressures referenced (with sources)`);
      for (const pid of citedPressures) {
        const p = PRESSURES_BY_ID[pid];
        if (p) lines.push(`- **${p.title}** (${p.origin}, severity ${p.severity}/5) — ${p.sourceName ?? 'source'}${p.sourceUrl ? `: ${p.sourceUrl}` : ''}${p.policyEngineRef ? ` · ${p.policyEngineRef.label}` : ''}`);
      }
    }
    lines.push(`\n### Grounding sources (${SOURCES.length})`);
    for (const s of SOURCES) lines.push(`- ${s.org} — ${s.what}: ${s.url}`);

    lines.push(`\n---\n_Keystone · /projects/dfe-data-strategy · a decision-support tool, not an official forecast. Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}._`);
    return lines.join('\n');
  }

  function exportMd() {
    const blob = new Blob([buildBrief()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dfe-data-strategy-brief-${app.scenarioName.replace(/\W+/g, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function exportDocx() {
    try {
      const res = await fetch('/projects/dfe-data-strategy/synth?export=docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: buildBrief(), title: `DfE data strategy — ${app.scenarioName}` }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dfe-data-strategy-brief.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      exportMd();
    }
  }
</script>

<svelte:head><title>Workbench — Keystone</title></svelte:head>

<div class="pe-route wide wb">
  <div class="wb-head">
    <div>
      <span class="pe-eyebrow">Private workbench · the diagnostic</span>
      <h1 class="pe-h1">Test a strategy against the pressures</h1>
    </div>
    <div class="wb-export">
      <button class="ex" onclick={exportMd} title="Download a markdown brief of this diagnostic">↓ Brief (.md)</button>
      <button class="ex" onclick={exportDocx} title="Download a Word brief of this diagnostic">↓ Brief (.docx)</button>
    </div>
  </div>
  <p class="wb-hint">Open the <b>Levers</b> (left) to set your posture and split the effort. Everything below updates live. Pin a strategy as <b>B</b> to compare two side by side.</p>

  <section class="card span">
    <h3 class="card-h">Alignment</h3>
    <AlignmentView />
  </section>

  <div class="cols">
    <section class="card">
      <h3 class="card-h">Pressure coverage</h3>
      <p class="card-sub">How well your strategy answers each pressure. Click one to see the working and its source.</p>
      <CoverageBars />
    </section>
    <div class="rightcol">
      <section class="card">
        <h3 class="card-h">Tensions</h3>
        <TensionList />
      </section>
      <section class="card">
        <h3 class="card-h">Recommended focus</h3>
        <RecommendedFocus />
      </section>
      <section class="card">
        <h3 class="card-h">Legal implications</h3>
        <LegalPanel />
      </section>
    </div>
  </div>

  <section class="card span">
    <h3 class="card-h">Data maturity</h3>
    <p class="card-sub">Self-assess where DfE is now and where you want it to be. The green shape is where this strategy could get you.</p>
    <MaturityRadar />
  </section>

  {#if app.uploads.length}
    <p class="wb-up">↪ {app.uploads.length} uploaded artefact{app.uploads.length === 1 ? '' : 's'} in this session — see <a href="/projects/dfe-data-strategy/workbench/upload">Upload</a>.</p>
  {:else}
    <p class="wb-up">Have an existing strategy or audit? <a href="/projects/dfe-data-strategy/workbench/upload">Upload it</a> and let the model synthesise it into this diagnostic.</p>
  {/if}

  <div class="wb-author">
    <div>
      <h3>Happy with the posture? Now write it down.</h3>
      <p>The diagnostic tests a stance; the <b>Author</b> turns it into the strategy document itself — sectioned drafting, automated gap checks against the commitments ledger, a roadmap and exports.</p>
    </div>
    <a class="pe-next" href="/projects/dfe-data-strategy/author">✎ Draft the strategy →</a>
  </div>
</div>

<style>
  .wb { padding-bottom: 28px; }
  .wb-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .wb-head .pe-h1 { margin-bottom: 4px; }
  .wb-export { display: flex; gap: 7px; }
  .ex { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 7px 11px; border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.6); border-radius: var(--radius-round); cursor: pointer; color: var(--ink); }
  .ex:hover { background: rgba(28,22,17,0.06); }
  .wb-hint { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.66); max-width: 80ch; }
  .wb-hint b { color: var(--ink); }
  .card { border: 1px solid rgba(28,22,17,0.12); background: rgba(255,255,255,0.4); border-radius: var(--radius-round); padding: 15px 17px; margin-bottom: 14px; }
  .card-h { margin: 0 0 8px; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--ink); }
  .card-sub { margin: -4px 0 10px; font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.6); }
  .cols { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 14px; align-items: start; }
  .rightcol { display: flex; flex-direction: column; }
  @media (max-width: 980px) { .cols { grid-template-columns: 1fr; } }
  .wb-up { margin: 6px 0 0; font-size: 12.5px; color: rgba(28,22,17,0.6); }
  .wb-up a { color: var(--accent-ink); }
  .wb-author { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin: 18px 0 0;
    padding: 15px 18px; border: 1px solid var(--accent-ink-tint-35); border-left: 4px solid var(--accent-ink); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); }
  .wb-author h3 { margin: 0 0 4px; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: var(--ink); }
  .wb-author p { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.7); max-width: 64ch; }
  .wb-author p b { color: var(--ink); }
</style>
