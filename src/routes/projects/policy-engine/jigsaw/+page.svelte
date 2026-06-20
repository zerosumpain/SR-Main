<script lang="ts">
  // The Information Jigsaw — Field Study №5: the flipside of Monitoring. Who holds
  // which piece of the picture of a child, their informational challenges, where DfE
  // can help (and can't), the RACI of information jobs, and the value offer if DfE
  // repositioned from collector to steward.
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import SpineSwitchboard from '../components/SpineSwitchboard.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';
  import AnalysisOnOutcome from '../components/AnalysisOnOutcome.svelte';
  import JoinsFunnel from '../components/JoinsFunnel.svelte';
  import CoordinationCost from '../components/CoordinationCost.svelte';
  import { STORIES } from '../lib/stories';
  import {
    JIGSAW_HERO, HOLDERS, RING_META, FAMILY_NOTE, RACI, RACI_COLS, TISSUE, TISSUE_KIND_META,
    GRAVEYARD, JIGSAW_GAPS, VALUE_OFFER, VALUE_DONTS,
    PRIVACY_PRECEDENTS, PRIVACY_BALANCE,
    type Holder, type Ring, type TissueKind,
  } from '../lib/jigsawIntel';

  const eli = $derived(app.narrative === 'eli5');

  // ---- ring map geometry ----
  const CX = 380, CY = 300, W = 760, H = 600;
  const RADII: Record<Ring, number> = { 1: 105, 2: 185, 3: 263 };
  let selectedId = $state<string | null>('school');
  const selected = $derived(selectedId ? HOLDERS.find((h) => h.id === selectedId) ?? null : null);

  const placed = $derived.by(() => {
    const byRing: Record<Ring, Holder[]> = { 1: [], 2: [], 3: [] };
    for (const h of HOLDERS) byRing[h.ring].push(h);
    const out: { h: Holder; x: number; y: number; a: number }[] = [];
    for (const ring of [1, 2, 3] as Ring[]) {
      const items = byRing[ring];
      const offset = ring === 1 ? -Math.PI / 2 : ring === 2 ? -Math.PI / 2 + Math.PI / items.length : -Math.PI / 2;
      items.forEach((h, i) => {
        const a = offset + (i / items.length) * 2 * Math.PI;
        out.push({ h, x: CX + RADII[ring] * Math.cos(a), y: CY + RADII[ring] * Math.sin(a), a });
      });
    }
    return out;
  });

  const RACI_META: Record<string, { label: string; bg: string; fg: string }> = {
    R: { label: 'Responsible — does the work', bg: 'rgba(47,125,79,0.85)', fg: '#fff' },
    A: { label: 'Accountable — owns the outcome', bg: '#1c1611', fg: '#f1ead6' },
    C: { label: 'Consulted', bg: 'rgba(47,111,151,0.75)', fg: '#fff' },
    I: { label: 'Informed', bg: 'rgba(28,22,17,0.18)', fg: '#1c1611' },
  };
  const rowHasA = (cells: Record<string, string>) => Object.values(cells).includes('A');
</script>

<svelte:head><title>The information jigsaw · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.jigsaw} />

  <!-- ===================== 1 · the number ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · The number, stated precisely</h2>
    <div class="hero81">
      <span class="h81-big">{JIGSAW_HERO.big}</span>
      <p class="h81-lab">{eli ? JIGSAW_HERO.labelEli5 : JIGSAW_HERO.label}</p>
    </div>
    <div class="precise-box">
      <div class="pb-head">
        <span class="pb-lab">{eli ? 'What the number does — and does not — say' : 'What the figure measures'}</span>
        <ConfidenceBadge level="high" note="The figure is verbatim from CSPRP 2025 §3.85. High confidence in the number; it describes a serious-incident review population, not all children, and not specifically information-sharing." />
      </div>
      <p class="pb-txt">{eli ? JIGSAW_HERO.preciseEli5 : JIGSAW_HERO.precise}</p>
    </div>
    <p class="h81-kicker">{eli ? JIGSAW_HERO.kicker.eli5 : JIGSAW_HERO.kicker.research}</p>
    <div class="refrow">
      {#each JIGSAW_HERO.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 1b · the privacy counter-thesis ===================== -->
  <section class="block">
    <h2 class="pe-h2">1b · The privacy counter-thesis — the proportionality ceiling</h2>
    <p class="cap">
      {eli
        ? 'Before reading the rest of this page as “join everything up”, look at the other side. Britain has tried large child-data systems before, and the courts and the privacy regulator have set real limits. These are not fringe objections — one of them is a Supreme Court ruling.'
        : 'The case for joining data up runs into a documented record of large child-data systems being curtailed on privacy and proportionality grounds. Presented at full weight first, then balanced neutrally: this is a legal constraint with case-law force, not a counter-opinion to be split down the middle.'}
    </p>
    <div class="prec-grid">
      {#each PRIVACY_PRECEDENTS as p (p.id)}
        <article class="prec">
          <header class="prec-head">
            <span class="prec-name">{p.name}</span>
            <span class="prec-period">{p.period}</span>
          </header>
          <p class="prec-sum">{eli ? p.eli5 : p.summary}</p>
          {#if !eli}<p class="prec-find">▸ {p.finding}</p>{/if}
          <div class="refrow">
            {#each p.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
          </div>
        </article>
      {/each}
    </div>

    <div class="balance">
      <div class="bal-head">
        <span class="bal-lab">⚖ {PRIVACY_BALANCE.title}</span>
        <ConfidenceBadge level="contested" note="A genuine, evidenced tension between two findings — not a settled answer. The safeguarding finding is about a review population; the legal finding is a binding proportionality ceiling." />
      </div>
      <p>{eli ? PRIVACY_BALANCE.eli5 : PRIVACY_BALANCE.research}</p>
      <div class="refrow">
        {#each PRIVACY_BALANCE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>

    <AnalysisOnOutcome theme="data-gap" title={eli ? 'What independent analysts find about joining children’s data' : 'What the analysts find — children’s-data governance and joining'} />
  </section>

  <!-- ===================== 2 · the map ===================== -->
  <section class="block">
    <h2 class="pe-h2">2 · The jigsaw, mapped — the child at the centre</h2>
    <p class="cap">
      {eli
        ? 'Every circle holds a piece of one child’s story. The closer to the centre, the more often they actually see the child. Notice where the Department for Education sits: the outer ring — it funds and counts, but it rarely sees. Click any circle.'
        : 'The ecosystem, drawn on purpose: the child at the centre, holders arranged by PROXIMITY OF SIGHT — universal services that see the child weekly, the local statutory tier that acts, and the national tier that funds, counts and sets rules. DfE sits in the outer ring by design: it holds the deepest longitudinal records and the shallowest day-to-day sight. Click any node for its purpose, its challenge, and where DfE can and cannot help.'}
    </p>
    <div class="map-scroll">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="The children's information ecosystem: holders arranged in three rings around the child">
        {#each [3, 2, 1] as r (r)}
          <circle cx={CX} cy={CY} r={RADII[r as Ring]} class="ring-c" style="stroke:{RING_META[r as Ring].colour}" />
        {/each}
        <!-- the child -->
        <circle cx={CX} cy={CY} r="34" class="child-c" />
        <text x={CX} y={CY - 2} class="child-t" text-anchor="middle">the</text>
        <text x={CX} y={CY + 12} class="child-t" text-anchor="middle">child</text>
        <!-- holders -->
        {#each placed as p (p.h.id)}
          {@const sel = selectedId === p.h.id}
          {@const isDfE = p.h.id === 'dfe'}
          <g role="button" tabindex="0" aria-label="Show details for {p.h.name}" style="cursor:pointer"
             onpointerdown={() => (selectedId = p.h.id)}
             onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedId = p.h.id; }}>
            <circle cx={p.x} cy={p.y} r={sel ? 11 : isDfE ? 10 : 8} fill={RING_META[p.h.ring].colour}
                    stroke={sel ? '#1c1611' : isDfE ? '#9a3b2e' : 'rgba(255,255,255,0.8)'} stroke-width={sel ? 2.5 : isDfE ? 2.5 : 1.2} />
            <text x={p.x + (Math.cos(p.a) >= 0.25 ? 14 : Math.cos(p.a) <= -0.25 ? -14 : 0)}
                  y={p.y + (Math.cos(p.a) >= 0.25 || Math.cos(p.a) <= -0.25 ? 4 : Math.sin(p.a) > 0 ? 22 : -14)}
                  class="node-t" class:sel class:dfe={isDfE}
                  text-anchor={Math.cos(p.a) >= 0.25 ? 'start' : Math.cos(p.a) <= -0.25 ? 'end' : 'middle'}>{p.h.name}</text>
          </g>
        {/each}
      </svg>
    </div>
    <div class="map-key">
      {#each [1, 2, 3] as r (r)}
        <span class="mk"><i style="background:{RING_META[r as Ring].colour}"></i>{eli ? RING_META[r as Ring].eli5 : RING_META[r as Ring].label}</span>
      {/each}
      <span class="mk"><i class="mk-dfe"></i>{eli ? 'DfE — out on the edge, on purpose' : 'DfE — outer ring, by design'}</span>
    </div>

    {#if selected}
      <div class="hcard" style="--hc:{RING_META[selected.ring].colour}">
        <div class="hc-head">
          <span class="hc-name">{selected.name}</span>
          <span class="hc-ring" style="background:{RING_META[selected.ring].colour}">{eli ? RING_META[selected.ring].eli5 : RING_META[selected.ring].label}</span>
        </div>
        <div class="hc-grid">
          <div class="hc-cell"><span class="hc-k">{eli ? 'Why they exist' : 'Purpose'}</span><p>{selected.purpose}</p></div>
          <div class="hc-cell"><span class="hc-k">{eli ? 'Their piece of the jigsaw' : 'What they hold'}</span><p>{selected.holds}</p></div>
          <div class="hc-cell"><span class="hc-k">{eli ? 'Their problem' : 'The informational challenge'}</span><p>{selected.challenge}</p></div>
          <div class="hc-cell can"><span class="hc-k">{eli ? 'Where the DfE could help' : 'Where DfE can help'}</span><p>{selected.dfeCan}</p></div>
          <div class="hc-cell cant"><span class="hc-k">{eli ? 'Where it can’t (or shouldn’t)' : 'Where DfE can’t'}</span><p>{selected.dfeCant}</p></div>
        </div>
        {#if selected.refs?.length}
          <div class="refrow">
            {#each selected.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="family">
      <span class="fam-lab">◉ {FAMILY_NOTE.title}</span>
      <p>{eli ? FAMILY_NOTE.eli5 : FAMILY_NOTE.research}</p>
      <div class="refrow">
        {#each FAMILY_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>
  </section>

  <!-- ===================== 3 · the RACI ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The RACI — ten information jobs, and who owns them</h2>
    <p class="cap">
      {eli
        ? 'For each job the information system has to do: who does the work (green R), who is accountable for the outcome (black A), who is asked (blue C), who is told (grey I). The highlighted rows are the ones to read closely — for several of the most important jobs, no single body is accountable.'
        : 'The information jobs the system must perform, gridded against the partners. R = responsible, A = accountable, C = consulted, I = informed. The analytical reading is the highlighted annotations: three jobs have no accountable owner — and these coincide with the co-ordination/handover gaps the CSPRP figure (§1) measures.'}
    </p>
    <div class="raci-scroll">
      <table class="raci">
        <thead>
          <tr><th class="job-h">{eli ? 'The job' : 'Information job'}</th>{#each RACI_COLS as c (c.id)}<th>{c.label}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each RACI as row (row.job)}
            <tr class:noA={!rowHasA(row.cells)}>
              <td class="job">{eli ? row.eli5 : row.job}</td>
              {#each RACI_COLS as c (c.id)}
                {@const v = row.cells[c.id]}
                <td class="cell">{#if v}<span class="pill" style="background:{RACI_META[v].bg};color:{RACI_META[v].fg}" title={RACI_META[v].label}>{v}</span>{:else}<span class="none">·</span>{/if}</td>
              {/each}
            </tr>
            {#if row.gap}
              <tr class="gaprow" class:noA={!rowHasA(row.cells)}><td colspan={RACI_COLS.length + 1}><span class="gap-txt">{#if !rowHasA(row.cells)}<b>⚠ </b>{/if}{row.gap}</span></td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    <div class="raci-key">
      {#each Object.entries(RACI_META) as [k, m] (k)}<span class="rk"><i style="background:{m.bg};color:{m.fg}">{k}</i>{m.label}</span>{/each}
      <span class="rk"><i class="rk-noa">⚠</i>{eli ? 'highlighted rows: nobody is accountable' : 'highlighted rows: no accountable owner'}</span>
    </div>
  </section>

  <!-- ===================== 4 · the connective tissue ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The connective tissue — and the graveyard</h2>
    <p class="cap">
      {eli
        ? 'A whole ecosystem of mostly-small organisations writes the rules, runs the pipes and checks the evidence that let all these systems talk. Here’s the full wall: who they are, what they actually run, and how fragile each one is — then the two times Britain built this capability and deleted it.'
        : 'The full connective-tissue landscape, grouped: the rule-writers, the live pipes and working tools, the sector organising itself, and the evidence layer. The fragility lines, read together, show a consistent pattern — health funds its standards institution as a standing body; most of the rest is funded grant round to grant round, with one hosting council. The graveyard section records that this capability has been built and discontinued more than once.'}
    </p>
    {#each Object.entries(TISSUE_KIND_META) as [kind, km] (kind)}
      <div class="ti-grp">
        <span class="ti-grp-lab">{eli ? km.eli5 : km.label}</span>
        <div class="ti-cards">
          {#each TISSUE.filter((t) => t.kind === (kind as TissueKind)) as t (t.name)}
            <article class="ti" style="--tc:{t.colour}">
              <header class="ti-head"><span class="ti-name">{t.name}</span><span class="ti-status">{t.status}</span></header>
              <p class="ti-what">{t.what}</p>
              <p class="ti-frag">▸ {t.fragility}</p>
              <a class="ti-src" href={t.url} target="_blank" rel="noopener">source ↗</a>
            </article>
          {/each}
        </div>
      </div>
    {/each}
    <div class="grave">
      <span class="gr-lab">⚰ {GRAVEYARD.title}</span>
      <p>{eli ? GRAVEYARD.eli5 : GRAVEYARD.research}</p>
      <div class="refrow">
        {#each GRAVEYARD.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>

    <div class="illus-wrap">
      <h3 class="illus-h">The coordination overhead, made tangible</h3>
      <p class="illus-cap">
        {eli
          ? 'A small toy to feel the shape of the problem: the more services hold a piece of one child, the more two-way links there are to keep working — and the more chance of the same work being done twice. The numbers are made up but shaped by real anchors; it does not touch the rest of the model.'
          : 'An illustrative device for the cost of fragmentation: coordination links grow quadratically with the number of holders, and duplicated collection costs staff time. The anchors are sourced (ContactPoint exposure; ~2.5h/referral) but the rates are labelled assumptions — it is not coupled to the policy engine.'}
      </p>
      <CoordinationCost />
    </div>
  </section>

  <!-- ===================== 5 · the gaps ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · The named gaps</h2>
    <div class="gaps">
      {#each JIGSAW_GAPS as g (g.gap)}
        <div class="gp">
          <span class="gp-name">{g.gap}</span><p class="gp-det">{eli ? g.eli5 : g.detail}</p>
          {#if g.refs?.length}
            <div class="refrow">
              {#each g.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="illus-wrap">
      <h3 class="illus-h">Children caught vs missed across the hand-offs</h3>
      <p class="illus-cap">
        {eli
          ? 'A second toy: drag the “how often a hand-over works” slider and watch how many children’s signal survives every hand-over versus how many get lost. The cohort is a real (if old and disputed) estimate; the rest is a simple model, labelled as such.'
          : 'A coverage slider over the hand-offs between holders: at a given per-hand-off join coverage, what share of an at-risk cohort’s signal survives every hand-off. The cohort anchor is the Children’s Commissioner estimate (dated, contested); the survival model is an explicit order-of-magnitude assumption, not engine-coupled.'}
      </p>
      <JoinsFunnel />
      <AnalysisOnOutcome theme="data-gap" max={3}
        title={eli ? 'What analysts say about counting the missing children' : 'What the analysts find — measuring who is missing'} />
    </div>
  </section>

  <!-- ===================== 6 · the switchboard ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The switchboard — wiring the jigsaw into the spine</h2>
    <p class="cap">
      {eli
        ? 'Here are the candidate joins, drawn as wires. Pick one: watch where the information starts, whether it goes through the new central “data spine” or straight between services, and who it reaches. Each one also shows what the sharer gets back, because a join where information only flows one way tends not to be used.'
        : 'The candidate joins, drawn as wires: each runs from the holder with the signal, through (or around) the data spine, to the receiver whose decision it changes. Grouped by what unlocks each — one live today, three buildable now, four awaiting the identifier, one a policy decision. Each is annotated against a reciprocity criterion (what the source gets back, not only what the centre extracts), since one-directional flows tend to see low adoption. Select a wire or a chip.'}
    </p>
    <SpineSwitchboard />
  </section>

  <!-- ===================== 7 · the value offer ===================== -->
  <section class="block" id="value-offer">
    <h2 class="pe-h2">7 · Repositioning options — collector to steward</h2>
    <p class="cap">
      {eli
        ? 'One way to read all of the above is to ask what kind of help the department would offer if it acted as a steward of joins rather than a collector of data. Five options follow — each fixes a join rather than building a database — set out so they can be judged, not endorsed.'
        : 'A descriptive frame for the analysis: if DfE repositioned from collector toward steward, what would that involve? Five options follow — each a join, none a central database — each with a cost order-of-magnitude, set out as evaluable options rather than recommendations, followed by three constraints the history makes testable.'}
    </p>
    <div class="vo-moves">
      {#each VALUE_OFFER as v, i (v.move)}
        <div class="vo">
          <span class="vo-n">{i + 1}</span>
          <div class="vo-body">
            <span class="vo-move">{v.move}</span>
            <span class="vo-what">{v.what}</span>
            <span class="vo-cost"><b>{eli ? 'How hard:' : 'Cost:'}</b> {v.cost}</span>
          </div>
        </div>
      {/each}
    </div>
    <div class="donts">
      <span class="do-lab">{eli ? 'Constraints the history makes testable' : 'Constraints — three the history makes testable'}</span>
      <p>{eli ? VALUE_DONTS.eli5 : VALUE_DONTS.research}</p>
      <a class="do-link" href="/projects/policy-engine/monitor">The same posture, tested system-wide → the subsidiarity test</a>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/neet">The jigsaw in action → the NEET early-warning case</a>
</div>

<style>
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: 14.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 92ch; }

  /* 1 · the number */
  .hero81 { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 18px 22px; border-radius: var(--radius-round);
    border: 1.5px solid var(--error-border); background: var(--error-bg); max-width: 96ch; }
  .h81-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(56px, 9vw, 96px); line-height: 0.9; color: #8a2d3a; }
  .h81-lab { margin: 0; flex: 1 1 320px; font-size: 15px; line-height: 1.55; color: rgba(28,22,17,0.8); }
  .h81-kicker { margin: 12px 0 0; font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 96ch; }

  /* 1 · precise-framing box */
  .precise-box { margin: 14px 0 0; border: 1px solid rgba(28,22,17,0.18); border-left: 3px solid var(--success); border-radius: var(--radius-round);
    background: var(--success-bg); padding: 12px 15px; max-width: 96ch; }
  .pb-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .pb-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--success); font-weight: 700; }
  .pb-txt { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.82); }

  /* 1b · privacy counter-thesis */
  .prec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); gap: 12px; margin-bottom: 14px; }
  .prec { border: 1px solid rgba(28,22,17,0.14); border-top: 3px solid var(--accent-ink); border-radius: var(--radius-round);
    background: var(--accent-ink-tint-06); padding: 12px 14px; display: flex; flex-direction: column; gap: 7px; }
  .prec-head { display: flex; flex-direction: column; gap: 2px; }
  .prec-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; line-height: 1.25; color: var(--ink); }
  .prec-period { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em; color: var(--accent-ink); }
  .prec-sum { margin: 0; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.78); }
  .prec-find { margin: 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.7); }
  .balance { border: 1.5px solid rgba(28,22,17,0.4); border-radius: var(--radius-round); background: rgba(28,22,17,0.045); padding: 13px 16px; max-width: 96ch; margin-bottom: 12px; }
  .bal-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .bal-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink); font-weight: 700; }
  .balance p { margin: 0 0 8px; font-size: 13px; line-height: 1.62; color: rgba(28,22,17,0.8); }

  /* illustrative-component wrappers */
  .illus-wrap { margin-top: 22px; padding-top: 16px; border-top: 1px dashed rgba(28,22,17,0.22); }
  .illus-h { margin: 0 0 5px; font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; color: var(--ink); }
  .illus-cap { margin: 0 0 13px; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.68); max-width: 92ch; }

  /* 2 · the map */
  .map-scroll { overflow-x: auto; background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 8px; }
  .map-scroll svg { display: block; width: 100%; min-width: 620px; height: auto; }
  .ring-c { fill: none; stroke-width: 1.2; stroke-dasharray: 3 4; opacity: 0.5; }
  .child-c { fill: #1c1611; }
  .child-t { font-family: 'Fraunces', serif; font-size: 13px; font-weight: 600; fill: #f1ead6; }
  .node-t { font-family: 'DM Sans', sans-serif; font-size: 11px; fill: rgba(28,22,17,0.78); }
  .node-t.sel { font-weight: 700; fill: #1c1611; }
  .node-t.dfe { font-weight: 700; fill: #9a3b2e; }
  .map-key { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0 0; }
  .mk { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.65); }
  .mk i { width: 10px; height: 10px; border-radius: var(--radius-pill); display: inline-block; }
  .mk-dfe { background: var(--accent-ink); border: 2px solid #9a3b2e; width: 7px !important; height: 7px !important; }

  .hcard { margin-top: 14px; border: 1px solid rgba(28,22,17,0.16); border-left: 4px solid var(--hc); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.55); padding: 13px 16px; }
  .hc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 9px; }
  .hc-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); }
  .hc-ring { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #fff; padding: 2px 7px; border-radius: var(--radius-round); }
  .hc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
  .hc-cell { border-left: 2px solid rgba(28,22,17,0.15); padding-left: 10px; }
  .hc-cell.can { border-left-color: var(--success); }
  .hc-cell.cant { border-left-color: var(--error); }
  .hc-k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); margin-bottom: 3px; }
  .hc-cell.can .hc-k { color: var(--success); } .hc-cell.cant .hc-k { color: #8a2d3a; }
  .hc-cell p { margin: 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.78); }

  /* the eighteenth holder */
  .family { margin-top: 16px; border: 1.5px solid rgba(28,22,17,0.5); border-radius: var(--radius-round); background: rgba(28,22,17,0.045); padding: 13px 16px; max-width: 96ch; }
  .fam-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); font-weight: 700; margin-bottom: 6px; }
  .family p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* 3 · RACI */
  .raci-scroll { overflow-x: auto; }
  .raci { border-collapse: collapse; width: 100%; min-width: 860px; }
  .raci th { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: rgba(28,22,17,0.55); padding: 4px 6px 6px; border-bottom: 1px solid rgba(28,22,17,0.18); }
  .raci th.job-h { text-align: left; }
  .raci td { padding: 7px 6px; }
  .raci td.job { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink); min-width: 190px; }
  .raci td.cell { text-align: center; }
  tr.noA td.job { color: #8a2d3a; }
  .pill { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--radius-round);
    font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; }
  .none { color: rgba(28,22,17,0.25); }
  tr.gaprow td { padding: 0 6px 12px; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .gap-txt { font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.62); }
  tr.gaprow.noA .gap-txt { color: #8a2d3a; }
  .raci-key { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
  .rk { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); }
  .rk i { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: var(--radius-round); font-size: 9px; font-weight: 700; font-style: normal; }
  .rk-noa { background: var(--error-bg); color: #8a2d3a; }

  /* 4 · tissue + graveyard */
  .ti-grp { margin-bottom: 18px; }
  .ti-grp-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(28,22,17,0.55); font-weight: 700; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px dashed rgba(28,22,17,0.25); }
  .ti-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; margin-bottom: 14px; }
  .ti { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--tc); border-radius: var(--radius-round); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 6px; }
  .ti-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ti-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink); }
  .ti-status { font-family: 'JetBrains Mono', monospace; font-size: 8px; color: var(--tc); }
  .ti-what { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .ti-frag { margin: 0; font-size: 11.5px; line-height: 1.45; font-weight: 600; color: #8a2d3a; }
  .ti-src { margin-top: auto; align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .grave { border: 1px dashed rgba(28,22,17,0.4); border-radius: var(--radius-round); background: rgba(28,22,17,0.04); padding: 13px 16px; max-width: 96ch; }
  .gr-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.65); font-weight: 600; margin-bottom: 6px; }
  .grave p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* 5 · gaps */
  .gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 10px; }
  .gp { border: 1px dashed var(--error-border); border-radius: var(--radius-round); padding: 10px 12px; background: var(--error-bg); }
  .gp-name { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #8a2d3a; text-transform: uppercase; letter-spacing: 0.04em; }
  .gp-det { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }

  /* citation chips */
  .refrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .refchip { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--accent-ink); text-decoration: none;
    border: 1px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); padding: 2px 7px; background: var(--accent-ink-tint-06); }
  .refchip:hover { border-color: var(--accent-ink); background: var(--accent-ink-tint-12); }

  /* 6 · value offer */
  .vo-moves { display: flex; flex-direction: column; gap: 9px; max-width: 96ch; margin-bottom: 14px; }
  .vo { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--success-border); border-radius: var(--radius-round); padding: 11px 14px; background: var(--success-bg); }
  .vo-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: var(--radius-pill); background: var(--success); color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .vo-body { display: flex; flex-direction: column; gap: 3px; }
  .vo-move { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink); }
  .vo-what { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .vo-cost { font-size: 11px; color: rgba(28,22,17,0.6); }
  .vo-cost b { color: var(--success); }
  .donts { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round);
    background: var(--accent-ink-tint-06); padding: 13px 16px; max-width: 96ch; }
  .do-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .donts p { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .do-link { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
