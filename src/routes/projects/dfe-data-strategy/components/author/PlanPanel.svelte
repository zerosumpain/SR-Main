<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { app } from '../../lib/appState.svelte';
  import { MEASURE_LIBRARY, suggestMilestones, suggestRisks, quarterRange } from '../../lib/author/plan';
  import { STAKEHOLDERS } from '../../lib/policy';
  import { markdownToHtml } from '../../lib/author/serialize';

  // ---- roadmap ----
  const quarters = $derived(quarterRange(author.milestones));
  const suggestions = $derived(suggestMilestones(author.milestones));
  let newMs = $state({ title: '', quarter: '2026-Q4', owner: '' });
  function addMs() {
    if (!newMs.title.trim()) return;
    author.addMilestone({ title: newMs.title.trim(), quarter: newMs.quarter, owner: newMs.owner.trim(), sectionId: 'delivery-roadmap' });
    newMs = { title: '', quarter: newMs.quarter, owner: '' };
  }
  function msByQuarter(q: string) {
    return author.milestones.filter((m) => m.quarter === q);
  }
  const undated = $derived(author.milestones.filter((m) => !/^\d{4}-Q[1-4]$/.test(m.quarter)));
  let insertedRoadmap = $state(false);
  function roadmapToDraft() {
    const target = author.doc.sections.find((s) => s.templateId === 'delivery-roadmap') ?? author.doc.sections[author.doc.sections.length - 1];
    const byQ = quarters.filter((q) => msByQuarter(q).length);
    const md = byQ
      .map((q) => `#### ${q.replace('-', ' ')}\n\n${msByQuarter(q).map((m) => `- ${m.title}${m.owner ? ` — _${m.owner}_` : ''}`).join('\n')}`)
      .join('\n\n');
    author.appendHtml(target.id, markdownToHtml(md));
    insertedRoadmap = true;
    setTimeout(() => (insertedRoadmap = false), 1400);
  }

  // ---- risks ----
  const riskSuggestions = $derived(suggestRisks(author.coverage, app.align.tensions, author.risks));
  let newRisk = $state({ title: '', likelihood: 3, impact: 3, mitigation: '' });
  function addRisk() {
    if (!newRisk.title.trim()) return;
    author.addRisk({ ...newRisk, title: newRisk.title.trim(), mitigation: newRisk.mitigation.trim() });
    newRisk = { title: '', likelihood: 3, impact: 3, mitigation: '' };
  }
  const riskAt = (l: number, i: number) => author.risks.filter((r) => r.likelihood === l && r.impact === i);
  const sev = (l: number, i: number) => (l * i >= 15 ? 'hot' : l * i >= 8 ? 'warm' : 'cool');
  let openRisk = $state<string | null>(null);

  // ---- measures ----
  const KINDS = [
    { id: 'strategy-health', label: 'Measures of the strategy' },
    { id: 'estate', label: 'Measures of the estate' },
    { id: 'outcome', label: 'Outcomes it serves' },
  ] as const;
  const chosen = (id: string) => author.measures.some((m) => m.id === id);
  function toggleMeasure(id: string) {
    const def = MEASURE_LIBRARY.find((m) => m.id === id);
    if (!def) return;
    if (chosen(id)) author.removeMeasure(id);
    else author.addMeasure({ id: def.id, name: def.name, source: def.source, sectionId: 'measurement' });
  }
  let insertedMeasures = $state(false);
  function measuresToDraft() {
    const target = author.doc.sections.find((s) => s.templateId === 'measurement') ?? author.doc.sections[author.doc.sections.length - 1];
    const md = author.measures
      .map((m) => `- **${m.name}** (${m.source})${m.baseline ? ` — baseline: ${m.baseline}` : ''}${m.target ? ` → target: ${m.target}` : ''}`)
      .join('\n');
    author.appendHtml(target.id, markdownToHtml(`### How we will measure this strategy\n\n${md}`));
    insertedMeasures = true;
    setTimeout(() => (insertedMeasures = false), 1400);
  }

  // ---- stakeholders ----
  const stStatus = (name: string) => author.stakeholders.find((s) => s.name === name)?.status ?? 'not-started';
  const cycle: Record<string, 'not-started' | 'planned' | 'consulted'> = { 'not-started': 'planned', planned: 'consulted', consulted: 'not-started' };
  const consulted = $derived(author.stakeholders.filter((s) => s.status === 'consulted').length);
</script>

<div class="pp">
  <section class="blk">
    <div class="blk-head">
      <h3 class="pp-h">Delivery roadmap</h3>
      <button class="ins" class:ok={insertedRoadmap} disabled={!author.milestones.length} onclick={roadmapToDraft}>
        {insertedRoadmap ? '✓ inserted' : '↳ insert into the draft'}
      </button>
    </div>
    {#if suggestions.length}
      <details class="sugg">
        <summary>▸ {suggestions.length} milestones suggested by the commitments' own deadlines</summary>
        <ul class="sugg-list">
          {#each suggestions as s}
            <li>
              <button class="sg-add" onclick={() => author.addMilestone(s)}>+ {s.quarter}</button>
              <span>{s.title}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
    <div class="road">
      {#each quarters as q}
        {@const items = msByQuarter(q)}
        <div class="q" class:has={items.length}>
          <span class="q-lab">{q.replace('-', ' ')}</span>
          {#each items as m (m.id)}
            <div class="ms">
              <span class="ms-t">{m.title}</span>
              {#if m.owner}<span class="ms-o">{m.owner}</span>{/if}
              <button class="ms-x" onclick={() => author.removeMilestone(m.id)} title="Remove">✕</button>
            </div>
          {/each}
        </div>
      {/each}
      {#if undated.length}
        <div class="q has">
          <span class="q-lab">unscheduled</span>
          {#each undated as m (m.id)}
            <div class="ms"><span class="ms-t">{m.title}</span><button class="ms-x" onclick={() => author.removeMilestone(m.id)}>✕</button></div>
          {/each}
        </div>
      {/if}
    </div>
    <div class="addbar">
      <input class="in grow" placeholder="Milestone…" bind:value={newMs.title} onkeydown={(e) => e.key === 'Enter' && addMs()} />
      <select class="in" bind:value={newMs.quarter}>
        {#each quarters as q}<option value={q}>{q.replace('-', ' ')}</option>{/each}
      </select>
      <input class="in" placeholder="Owner" bind:value={newMs.owner} onkeydown={(e) => e.key === 'Enter' && addMs()} />
      <button class="add" onclick={addMs}>+ Add</button>
    </div>
  </section>

  <div class="two">
    <section class="blk">
      <h3 class="pp-h">Risk register</h3>
      {#if riskSuggestions.length}
        <details class="sugg">
          <summary>▸ {riskSuggestions.length} risks suggested by the gaps and tensions</summary>
          <ul class="sugg-list">
            {#each riskSuggestions as r}
              <li>
                <button class="sg-add" onclick={() => author.addRisk(r)}>+ L{r.likelihood}·I{r.impact}</button>
                <span>{r.title}</span>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <div class="matrix">
        <span class="ax-y">Likelihood →</span>
        {#each [5, 4, 3, 2, 1] as l}
          {#each [1, 2, 3, 4, 5] as i}
            {@const items = riskAt(l, i)}
            <div class="cell {sev(l, i)}" class:has={items.length} title="likelihood {l} × impact {i}">
              {#each items as r (r.id)}
                <button class="r-chip" onclick={() => (openRisk = openRisk === r.id ? null : r.id)} title={r.title}>{r.title.slice(0, 18)}{r.title.length > 18 ? '…' : ''}</button>
              {/each}
            </div>
          {/each}
        {/each}
        <span class="ax-x">Impact →</span>
      </div>
      {#if openRisk}
        {@const r = author.risks.find((x) => x.id === openRisk)}
        {#if r}
          <div class="r-detail">
            <b>{r.title}</b>
            <p>{r.mitigation || 'No mitigation written yet.'}</p>
            <div class="r-ops">
              <label>L <input type="number" min="1" max="5" value={r.likelihood} onchange={(e) => author.updateRisk(r.id, { likelihood: Math.max(1, Math.min(5, +(e.target as HTMLInputElement).value)) })} /></label>
              <label>I <input type="number" min="1" max="5" value={r.impact} onchange={(e) => author.updateRisk(r.id, { impact: Math.max(1, Math.min(5, +(e.target as HTMLInputElement).value)) })} /></label>
              <button class="ms-x" onclick={() => (author.removeRisk(r.id), (openRisk = null))}>✕ remove</button>
            </div>
          </div>
        {/if}
      {/if}
      <div class="addbar">
        <input class="in grow" placeholder="Risk…" bind:value={newRisk.title} onkeydown={(e) => e.key === 'Enter' && addRisk()} />
        <input class="in mit" placeholder="Mitigation" bind:value={newRisk.mitigation} />
        <button class="add" onclick={addRisk}>+ Add</button>
      </div>
    </section>

    <section class="blk">
      <div class="blk-head">
        <h3 class="pp-h">Success measures</h3>
        <button class="ins" class:ok={insertedMeasures} disabled={!author.measures.length} onclick={measuresToDraft}>
          {insertedMeasures ? '✓ inserted' : '↳ insert into the draft'}
        </button>
      </div>
      {#each KINDS as k}
        <span class="k-lab">{k.label}</span>
        <div class="mrow">
          {#each MEASURE_LIBRARY.filter((m) => m.kind === k.id) as m (m.id)}
            <button class="m-chip" class:on={chosen(m.id)} title="{m.note} — {m.source}" onclick={() => toggleMeasure(m.id)}>
              {chosen(m.id) ? '✓ ' : ''}{m.name}
            </button>
          {/each}
        </div>
      {/each}
      {#if author.measures.length}
        <div class="m-picked">
          {#each author.measures as m (m.id)}
            <div class="m-edit">
              <span class="m-name">{m.name}</span>
              <input class="in tiny" placeholder="baseline" value={m.baseline ?? ''} onchange={(e) => author.updateMeasure(m.id, { baseline: (e.target as HTMLInputElement).value })} />
              <span class="arr">→</span>
              <input class="in tiny" placeholder="target" value={m.target ?? ''} onchange={(e) => author.updateMeasure(m.id, { target: (e.target as HTMLInputElement).value })} />
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>

  <section class="blk">
    <h3 class="pp-h">Consultation tracker <span class="st-sum">{consulted}/{STAKEHOLDERS.length} consulted</span></h3>
    <p class="st-note">A strategy nobody was consulted on is a strategy nobody will deliver. Click to cycle: not started → planned → consulted.</p>
    <div class="st-grid">
      {#each STAKEHOLDERS as name}
        {@const st = stStatus(name)}
        <button class="st {st}" onclick={() => author.setStakeholder(name, cycle[st])}>
          <i>{st === 'consulted' ? '✓' : st === 'planned' ? '◐' : '○'}</i>
          {name}
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .pp {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .blk {
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
    padding: 14px 17px;
  }
  .blk-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .pp-h {
    margin: 0 0 10px;
    font-family: 'Fraunces', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .blk-head .pp-h {
    margin-bottom: 10px;
  }
  .ins {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 5px 11px;
    background: var(--accent-ink-tint-06);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .ins:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ins.ok {
    border-color: #2f6155;
    color: #2f6155;
  }
  .sugg {
    margin-bottom: 10px;
  }
  .sugg summary {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--accent-ink);
    cursor: pointer;
  }
  .sugg-list {
    list-style: none;
    margin: 7px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sugg-list li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    color: rgba(28, 22, 17, 0.72);
  }
  .sg-add {
    flex: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .sg-add:hover {
    background: var(--accent-ink-tint-12);
  }

  .road {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }
  .q {
    border: 1px dashed rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round);
    padding: 7px 9px;
    min-height: 52px;
  }
  .q.has {
    border-style: solid;
    background: rgba(241, 234, 214, 0.45);
  }
  .q-lab {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin-bottom: 5px;
  }
  .ms {
    position: relative;
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-left: 3px solid var(--accent-ink);
    border-radius: var(--radius-round);
    padding: 5px 20px 5px 8px;
    margin-bottom: 5px;
  }
  .ms-t {
    display: block;
    font-size: 11px;
    line-height: 1.4;
    color: var(--ink);
  }
  .ms-o {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    color: rgba(28, 22, 17, 0.5);
  }
  .ms-x {
    position: absolute;
    top: 3px;
    right: 4px;
    background: none;
    border: none;
    font-size: 9px;
    color: rgba(28, 22, 17, 0.4);
    cursor: pointer;
  }
  .ms-x:hover {
    color: var(--error, #a33);
  }
  .addbar {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .in {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    padding: 6px 9px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.7);
    color: var(--ink);
  }
  .in.grow {
    flex: 1;
    min-width: 180px;
  }
  .in.mit {
    flex: 1;
    min-width: 140px;
  }
  .in.tiny {
    width: 90px;
    padding: 3px 7px;
    font-size: 11px;
  }
  .add {
    font-family: 'DM Sans', sans-serif;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 13px;
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border: none;
    border-radius: var(--radius-round);
    cursor: pointer;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
  }
  .matrix {
    position: relative;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 3px;
    padding: 0 0 18px 18px;
  }
  .ax-y {
    position: absolute;
    left: -2px;
    top: 50%;
    transform: rotate(-90deg) translateX(50%);
    transform-origin: left;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
  }
  .ax-x {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
  }
  .cell {
    min-height: 34px;
    border-radius: 4px;
    padding: 2px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cell.cool {
    background: rgba(47, 97, 85, 0.1);
  }
  .cell.warm {
    background: rgba(176, 125, 43, 0.16);
  }
  .cell.hot {
    background: rgba(176, 74, 47, 0.2);
  }
  .r-chip {
    font-size: 9px;
    line-height: 1.2;
    text-align: left;
    padding: 2px 5px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: 3px;
    color: var(--ink);
    cursor: pointer;
  }
  .r-detail {
    margin-top: 8px;
    padding: 8px 12px;
    border-left: 3px solid var(--accent-ink);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
  }
  .r-detail b {
    font-size: 12.5px;
    color: var(--ink);
  }
  .r-detail p {
    margin: 4px 0 6px;
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.7);
  }
  .r-ops {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .r-ops label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.6);
  }
  .r-ops input {
    width: 40px;
    margin-left: 3px;
    font-size: 11px;
    padding: 2px 5px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.8);
  }
  .r-ops .ms-x {
    position: static;
    font-size: 10px;
  }

  .k-lab {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    margin: 9px 0 5px;
  }
  .mrow {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .m-chip {
    font-size: 10.5px;
    padding: 3px 9px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    color: rgba(28, 22, 17, 0.75);
    cursor: pointer;
  }
  .m-chip:hover {
    border-color: rgba(28, 22, 17, 0.45);
  }
  .m-chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper, #f1ead6);
  }
  .m-picked {
    margin-top: 11px;
    border-top: 1px dashed rgba(28, 22, 17, 0.18);
    padding-top: 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .m-edit {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }
  .m-name {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink);
    flex: 1;
    min-width: 160px;
  }
  .arr {
    color: rgba(28, 22, 17, 0.4);
    font-size: 11px;
  }

  .st-sum {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--accent-ink);
    margin-left: 8px;
  }
  .st-note {
    margin: -4px 0 10px;
    font-size: 11.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .st-grid {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    padding: 5px 11px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    color: rgba(28, 22, 17, 0.7);
    cursor: pointer;
  }
  .st i {
    font-style: normal;
    font-size: 11px;
  }
  .st.planned {
    border-color: #b07d2b;
    color: #7d5a1f;
    background: rgba(176, 125, 43, 0.08);
  }
  .st.consulted {
    border-color: #2f6155;
    color: #2f6155;
    background: rgba(47, 97, 85, 0.08);
  }
  @media (max-width: 1000px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
