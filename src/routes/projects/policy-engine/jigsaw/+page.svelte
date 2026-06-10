<script lang="ts">
  // The Information Jigsaw — Field Study №6: the flipside of Monitoring. Who holds
  // which piece of the picture of a child, their informational challenges, where DfE
  // can help (and can't), the RACI of information jobs, and the value offer if DfE
  // repositioned from collector to steward.
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import SpineSwitchboard from '../components/SpineSwitchboard.svelte';
  import { STORIES } from '../lib/stories';
  import {
    JIGSAW_HERO, HOLDERS, RING_META, RACI, RACI_COLS, TISSUE, TISSUE_KIND_META, GRAVEYARD,
    JIGSAW_GAPS, VALUE_OFFER, VALUE_DONTS, type Holder, type Ring, type TissueKind,
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
    <h2 class="pe-h2">1 · The number that frames everything</h2>
    <div class="hero81">
      <span class="h81-big">{JIGSAW_HERO.big}</span>
      <p class="h81-lab">{eli ? JIGSAW_HERO.labelEli5 : JIGSAW_HERO.label}</p>
    </div>
    <p class="h81-kicker">{eli ? JIGSAW_HERO.kicker.eli5 : JIGSAW_HERO.kicker.research}</p>
    <div class="refrow">
      {#each JIGSAW_HERO.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
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
  </section>

  <!-- ===================== 3 · the RACI ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The RACI — ten information jobs, and who owns them</h2>
    <p class="cap">
      {eli
        ? 'For each job the information system has to do: who does the work (green R), who carries the can (black A), who’s asked (blue C), who’s told (grey I). Read the red rows carefully — for some of the most important jobs, NOBODY carries the can.'
        : 'The information jobs the system must perform, gridded against the partners. R = responsible, A = accountable, C = consulted, I = informed. The strategic reading is the red annotations: three jobs have NO accountable owner — and they are precisely where the 81% lives.'}
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
      <span class="rk"><i class="rk-noa">⚠</i>{eli ? 'red rows: nobody carries the can' : 'highlighted rows: no accountable owner'}</span>
    </div>
  </section>

  <!-- ===================== 4 · the connective tissue ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The connective tissue — and the graveyard</h2>
    <p class="cap">
      {eli
        ? 'A whole ecosystem of mostly-small organisations writes the rules, runs the pipes and checks the evidence that let all these systems talk. Here’s the full wall: who they are, what they actually run, and how fragile each one is — then the two times Britain built this capability and deleted it.'
        : 'The full connective-tissue landscape, grouped: the rule-writers, the live pipes and working tools, the sector organising itself, and the evidence layer. Read the fragility lines together and a pattern emerges — health funds its standards institution properly; nearly everything else runs on grant rounds, goodwill and one hosting council. And the graveyard matters: this capability has been built and dismantled twice.'}
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
  </section>

  <!-- ===================== 6 · the switchboard ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The switchboard — wiring the jigsaw into the spine</h2>
    <p class="cap">
      {eli
        ? 'Here are the joins worth building, drawn as wires. Pick one: watch where the information starts, whether it goes through the new central “data spine” or straight between services, and who it reaches. Each one says what the sharer gets back — sharing should never be a one-way street.'
        : 'The opportunity space, made concrete: every named join drawn as a wire from the holder who has the signal, through (or deliberately around) the data spine, to the receiver whose decision it changes. Grouped by what unlocks it — one is live today, three are buildable now, four wait on the identifier, one on a policy decision. Every wire passes the anti-paternal test: it states what the source GETS BACK, not just what the centre extracts. Select a wire or a chip.'}
    </p>
    <SpineSwitchboard />
  </section>

  <!-- ===================== 7 · the value offer ===================== -->
  <section class="block" id="value-offer">
    <h2 class="pe-h2">7 · The value offer — collector to steward</h2>
    <p class="cap">
      {eli
        ? 'If the department changed what kind of help it offers, here’s what that would look like — five moves, each fixing a join rather than building a database.'
        : 'The strategic question this page exists to sharpen: what is DfE’s value offer to the system if it repositions from collector to STEWARD? Five moves — each a join, none a database — and the three don’ts the history teaches.'}
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
      <span class="do-lab">{eli ? 'And what not to do' : 'The don’ts — and the offer in one sentence'}</span>
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
  .hero81 { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 18px 22px; border-radius: 14px;
    border: 1.5px solid rgba(177,69,94,0.45); background: rgba(177,69,94,0.06); max-width: 96ch; }
  .h81-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(56px, 9vw, 96px); line-height: 0.9; color: #8a2d3a; }
  .h81-lab { margin: 0; flex: 1 1 320px; font-size: 15px; line-height: 1.55; color: rgba(28,22,17,0.8); }
  .h81-kicker { margin: 12px 0 0; font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 96ch; }

  /* 2 · the map */
  .map-scroll { overflow-x: auto; background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 8px; }
  .map-scroll svg { display: block; width: 100%; min-width: 620px; height: auto; }
  .ring-c { fill: none; stroke-width: 1.2; stroke-dasharray: 3 4; opacity: 0.5; }
  .child-c { fill: #1c1611; }
  .child-t { font-family: 'Fraunces', serif; font-size: 13px; font-weight: 600; fill: #f1ead6; }
  .node-t { font-family: 'DM Sans', sans-serif; font-size: 11px; fill: rgba(28,22,17,0.78); }
  .node-t.sel { font-weight: 700; fill: #1c1611; }
  .node-t.dfe { font-weight: 700; fill: #9a3b2e; }
  .map-key { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0 0; }
  .mk { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.65); }
  .mk i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .mk-dfe { background: #7a5aa6; border: 2px solid #9a3b2e; width: 7px !important; height: 7px !important; }

  .hcard { margin-top: 14px; border: 1px solid rgba(28,22,17,0.16); border-left: 4px solid var(--hc); border-radius: 10px;
    background: rgba(255,255,255,0.55); padding: 13px 16px; }
  .hc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 9px; }
  .hc-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink, #1c1611); }
  .hc-ring { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #fff; padding: 2px 7px; border-radius: 4px; }
  .hc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
  .hc-cell { border-left: 2px solid rgba(28,22,17,0.15); padding-left: 10px; }
  .hc-cell.can { border-left-color: #2f7d4f; }
  .hc-cell.cant { border-left-color: #b1455e; }
  .hc-k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); margin-bottom: 3px; }
  .hc-cell.can .hc-k { color: #2f7d4f; } .hc-cell.cant .hc-k { color: #8a2d3a; }
  .hc-cell p { margin: 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.78); }

  /* 3 · RACI */
  .raci-scroll { overflow-x: auto; }
  .raci { border-collapse: collapse; width: 100%; min-width: 860px; }
  .raci th { text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: rgba(28,22,17,0.55); padding: 4px 6px 6px; border-bottom: 1px solid rgba(28,22,17,0.18); }
  .raci th.job-h { text-align: left; }
  .raci td { padding: 7px 6px; }
  .raci td.job { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; color: var(--ink, #1c1611); min-width: 190px; }
  .raci td.cell { text-align: center; }
  tr.noA td.job { color: #8a2d3a; }
  .pill { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; }
  .none { color: rgba(28,22,17,0.25); }
  tr.gaprow td { padding: 0 6px 12px; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .gap-txt { font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.62); }
  tr.gaprow.noA .gap-txt { color: #8a2d3a; }
  .raci-key { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
  .rk { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); }
  .rk i { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; font-size: 9px; font-weight: 700; font-style: normal; }
  .rk-noa { background: rgba(177,69,94,0.12); color: #8a2d3a; }

  /* 4 · tissue + graveyard */
  .ti-grp { margin-bottom: 18px; }
  .ti-grp-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(28,22,17,0.55); font-weight: 700; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px dashed rgba(28,22,17,0.25); }
  .ti-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; margin-bottom: 14px; }
  .ti { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--tc); border-radius: 10px; padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 6px; }
  .ti-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ti-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .ti-status { font-family: 'JetBrains Mono', monospace; font-size: 8px; color: var(--tc); }
  .ti-what { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .ti-frag { margin: 0; font-size: 11.5px; line-height: 1.45; font-weight: 600; color: #8a2d3a; }
  .ti-src { margin-top: auto; align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .grave { border: 1px dashed rgba(28,22,17,0.4); border-radius: 10px; background: rgba(28,22,17,0.04); padding: 13px 16px; max-width: 96ch; }
  .gr-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.65); font-weight: 600; margin-bottom: 6px; }
  .grave p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* 5 · gaps */
  .gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 10px; }
  .gp { border: 1px dashed rgba(177,69,94,0.45); border-radius: 9px; padding: 10px 12px; background: rgba(177,69,94,0.04); }
  .gp-name { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #8a2d3a; text-transform: uppercase; letter-spacing: 0.04em; }
  .gp-det { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }

  /* citation chips */
  .refrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .refchip { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: #2f6f97; text-decoration: none;
    border: 1px solid rgba(47,111,151,0.3); border-radius: 5px; padding: 2px 7px; background: rgba(47,111,151,0.05); }
  .refchip:hover { border-color: #2f6f97; background: rgba(47,111,151,0.1); }

  /* 6 · value offer */
  .vo-moves { display: flex; flex-direction: column; gap: 9px; max-width: 96ch; margin-bottom: 14px; }
  .vo { display: flex; gap: 12px; align-items: flex-start; border: 1px solid rgba(47,125,79,0.3); border-radius: 10px; padding: 11px 14px; background: rgba(47,125,79,0.04); }
  .vo-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #2f7d4f; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .vo-body { display: flex; flex-direction: column; gap: 3px; }
  .vo-move { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .vo-what { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .vo-cost { font-size: 11px; color: rgba(28,22,17,0.6); }
  .vo-cost b { color: #2f7d4f; }
  .donts { border: 1px solid rgba(74,124,124,0.35); border-left: 3px solid #4a7c7c; border-radius: 10px;
    background: rgba(74,124,124,0.06); padding: 13px 16px; max-width: 96ch; }
  .do-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #3a5f5f; font-weight: 600; margin-bottom: 6px; }
  .donts p { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .do-link { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
