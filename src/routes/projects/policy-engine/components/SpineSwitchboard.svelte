<script lang="ts">
  // SpineSwitchboard — the interactive joins board: every named opportunity on the
  // jigsaw drawn as a wire from holder → data spine → receiver. All wires visible
  // faintly (the opportunity space); the selected one energises. Direct Encompass-
  // pattern pushes deliberately bypass the spine — that contrast is the point.
  import { app } from '../lib/appState.svelte';
  import { HOLDERS, RING_META, SPINE_OPPS, SPINE_STATUS_META, type SpineOpp, type SpineStatus } from '../lib/jigsawIntel';

  const eli = $derived(app.narrative === 'eli5');

  let selectedId = $state('encompass');
  const opp = $derived(SPINE_OPPS.find((o) => o.id === selectedId) ?? SPINE_OPPS[0]);

  // ---- board geometry ----
  const W = 960;
  const SRC_ORDER = ['police', 'school', 'icb', 'housing', 'hv', 'nhse', 'cafcass', 'lacsc', 'dwp'];
  const DST_ORDER = ['school', 'mash', 'ey', 'lacsc', 'dfe', 'ofsted'];
  const NW = 196, NH = 34, VGAP = 16, TOP = 46;
  const H = TOP + SRC_ORDER.length * (NH + VGAP) + 12;
  const SX = 12, DX = W - NW - 12;
  const SPX = 430, SPW = 100, SPT = TOP - 6, SPB = H - 18;

  const holder = (id: string) => HOLDERS.find((h) => h.id === id)!;
  const colY = (order: string[], id: string) => {
    const n = order.length;
    const span = n * (NH + VGAP) - VGAP;
    const start = TOP + (SRC_ORDER.length * (NH + VGAP) - VGAP - span) / 2;
    return start + order.indexOf(id) * (NH + VGAP) + NH / 2;
  };
  const srcY = (id: string) => colY(SRC_ORDER, id);
  const dstY = (id: string) => colY(DST_ORDER, id);

  // spine entry point per opportunity — staggered down the capsule
  const spineOpps = SPINE_OPPS.filter((o) => o.via === 'spine');
  const spY = (o: SpineOpp) => {
    const i = spineOpps.indexOf(o);
    return SPT + 38 + (i / Math.max(1, spineOpps.length - 1)) * (SPB - SPT - 76);
  };

  interface Wire { d: string; opp: SpineOpp; }
  const wires = $derived.by(() => {
    const out: Wire[] = [];
    for (const o of SPINE_OPPS) {
      if (o.via === 'direct') {
        for (const f of o.from) for (const t of o.to) {
          const sy = srcY(f), ty = dstY(t);
          const top = Math.max(14, Math.min(sy, ty) - 64);
          out.push({ d: `M ${SX + NW} ${sy} C ${SPX - 40} ${top}, ${SPX + SPW + 40} ${top}, ${DX} ${ty}`, opp: o });
        }
      } else {
        const y = spY(o);
        for (const f of o.from) {
          const sy = srcY(f);
          out.push({ d: `M ${SX + NW} ${sy} C ${SX + NW + 110} ${sy}, ${SPX - 90} ${y}, ${SPX} ${y}`, opp: o });
        }
        for (const t of o.to) {
          const ty = dstY(t);
          out.push({ d: `M ${SPX + SPW} ${y} C ${SPX + SPW + 90} ${y}, ${DX - 110} ${ty}, ${DX} ${ty}`, opp: o });
        }
      }
    }
    return out;
  });

  const srcActive = (id: string) => opp.from.includes(id);
  const dstActive = (id: string) => opp.to.includes(id);
  const statusOf = (s: SpineStatus) => SPINE_STATUS_META[s];

  // chips grouped by status, in narrative order
  const STATUS_ORDER: SpineStatus[] = ['live', 'now', 'identifier', 'policy'];
</script>

<!-- ---- the chips ---- -->
<div class="sw-chips">
  {#each STATUS_ORDER as s (s)}
    {@const opps = SPINE_OPPS.filter((o) => o.status === s)}
    <div class="sw-grp">
      <span class="sw-grp-lab" style="color:{statusOf(s).colour}">{eli ? statusOf(s).eli5 : statusOf(s).label}</span>
      <div class="sw-grp-row">
        {#each opps as o (o.id)}
          <button class="sw-chip" class:on={selectedId === o.id} style="--sc:{statusOf(o.status).colour}"
                  onclick={() => (selectedId = o.id)}>
            <i></i>{eli ? o.titleEli5 : o.title}<span class="sw-cost">{o.cost}</span>
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<!-- ---- the board ---- -->
<div class="sw-scroll">
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="The switchboard: opportunities wired from data holders through the data spine to receivers">
    <text x={SX} y={26} class="sw-col-lab">{eli ? 'Who has the information' : 'Holders — where the signal starts'}</text>
    <text x={DX + NW} y={26} class="sw-col-lab" text-anchor="end">{eli ? 'Who needs it' : 'Receivers — where it changes a decision'}</text>

    <!-- wires: all faint, selected energised. direct wires drawn after spine so they cross over it -->
    {#each wires.filter((w) => w.opp.via === 'spine') as w, i (w.opp.id + i)}
      <path d={w.d} class="wire" class:active={w.opp.id === selectedId} style="--wc:{statusOf(w.opp.status).colour}" />
      <path d={w.d} class="hit" role="button" tabindex="-1" aria-label="Select {w.opp.title}"
            onpointerdown={() => (selectedId = w.opp.id)} onkeydown={(e) => { if (e.key === 'Enter') selectedId = w.opp.id; }} />
    {/each}

    <!-- the spine -->
    <rect x={SPX} y={SPT} width={SPW} height={SPB - SPT} rx="18" class="spine" class:lit={opp.via === 'spine'} />
    <text x={SPX + SPW / 2} y={SPT + 22} class="sp-t" text-anchor="middle">THE DATA</text>
    <text x={SPX + SPW / 2} y={SPT + 36} class="sp-t" text-anchor="middle">SPINE</text>
    <text x={SPX + SPW / 2} y={SPB - 26} class="sp-sub" text-anchor="middle">consistent</text>
    <text x={SPX + SPW / 2} y={SPB - 15} class="sp-sub" text-anchor="middle">identifier</text>
    {#each spineOpps as o (o.id)}
      <circle cx={SPX} cy={spY(o)} r="3" class="port" class:on={o.id === selectedId} style="--wc:{statusOf(o.status).colour}" />
      <circle cx={SPX + SPW} cy={spY(o)} r="3" class="port" class:on={o.id === selectedId} style="--wc:{statusOf(o.status).colour}" />
    {/each}

    {#each wires.filter((w) => w.opp.via === 'direct') as w, i (w.opp.id + 'd' + i)}
      <path d={w.d} class="wire direct" class:active={w.opp.id === selectedId} style="--wc:{statusOf(w.opp.status).colour}" />
      <path d={w.d} class="hit" role="button" tabindex="-1" aria-label="Select {w.opp.title}"
            onpointerdown={() => (selectedId = w.opp.id)} onkeydown={(e) => { if (e.key === 'Enter') selectedId = w.opp.id; }} />
    {/each}

    <!-- holder nodes -->
    {#each SRC_ORDER as id (id)}
      {@const h = holder(id)}
      <g class="nd" class:on={srcActive(id)} class:dim={!srcActive(id)}>
        <rect x={SX} y={srcY(id) - NH / 2} width={NW} height={NH} rx="8" class="nd-r" style="--rc:{RING_META[h.ring].colour}" />
        <text x={SX + 12} y={srcY(id) + 4} class="nd-t">{h.name}</text>
      </g>
    {/each}
    {#each DST_ORDER as id (id)}
      {@const h = holder(id)}
      <g class="nd" class:on={dstActive(id)} class:dim={!dstActive(id)}>
        <rect x={DX} y={dstY(id) - NH / 2} width={NW} height={NH} rx="8" class="nd-r dst" style="--rc:{RING_META[h.ring].colour}" />
        <text x={DX + 12} y={dstY(id) + 4} class="nd-t">{h.name}</text>
      </g>
    {/each}
  </svg>
</div>

<!-- ---- the detail panel ---- -->
<div class="sw-detail" style="--sc:{statusOf(opp.status).colour}">
  <header class="swd-head">
    <span class="swd-title">{eli ? opp.titleEli5 : opp.title}</span>
    <span class="swd-pill" style="background:{statusOf(opp.status).colour}">{eli ? statusOf(opp.status).eli5 : statusOf(opp.status).label}</span>
    <span class="swd-via">{opp.via === 'spine' ? (eli ? 'goes through the spine' : 'routed through the spine') : (eli ? 'goes straight there — no big database' : 'direct push — never touches the spine')}</span>
    {#if opp.move > 0}<a class="swd-move" href="#value-offer">advances move {opp.move} ↓</a>{/if}
  </header>
  <div class="swd-grid">
    <div class="swd-cell"><span class="swd-k">{eli ? 'What moves' : 'What moves'}</span><p>{eli ? opp.whatEli5 : opp.what}</p></div>
    <div class="swd-cell"><span class="swd-k">{eli ? 'How it works' : 'The mechanism'}</span><p>{opp.mechanism}</p></div>
    <div class="swd-cell exch">
      <span class="swd-k">{eli ? 'The deal' : 'The exchange — the anti-paternal test'}</span>
      <p><b class="g">gives:</b> {opp.gives}</p>
      <p><b class="gb">gets back:</b> {opp.getsBack}</p>
    </div>
    <div class="swd-cell"><span class="swd-k">{eli ? 'What’s in the way' : 'Blocked by'}</span><p>{opp.blockedBy}</p></div>
    <div class="swd-cell"><span class="swd-k">{eli ? 'Proof it can work' : 'Precedent'}</span><p>{opp.precedent}</p></div>
  </div>
</div>

<style>
  /* chips */
  .sw-chips { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
  .sw-grp { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .sw-grp-lab { flex: 0 0 200px; font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .sw-grp-row { display: flex; gap: 7px; flex-wrap: wrap; }
  .sw-chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgba(28,22,17,0.22); border-radius: 8px;
    background: rgba(255,255,255,0.55); padding: 5px 11px; font-family: 'DM Sans', sans-serif; font-size: 12px; color: var(--ink, #1c1611); cursor: pointer;
    transition: background 0.12s, border-color 0.12s; }
  .sw-chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--sc); }
  .sw-chip:hover { border-color: var(--sc); }
  .sw-chip.on { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-color: var(--ink, #1c1611); }
  .sw-cost { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; opacity: 0.6; }
  @media (max-width: 760px) { .sw-grp-lab { flex-basis: 100%; } }

  /* board */
  .sw-scroll { overflow-x: auto; background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 8px; }
  .sw-scroll svg { display: block; width: 100%; min-width: 860px; height: auto; }
  .sw-col-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; fill: rgba(28,22,17,0.5); }

  .wire { fill: none; stroke: var(--wc); stroke-width: 1.4; opacity: 0.18; transition: opacity 0.15s; }
  .wire.direct { stroke-dasharray: 5 4; }
  .wire.active { opacity: 1; stroke-width: 2.6; stroke-dasharray: 8 7; animation: flow 0.85s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -15; } }
  @media (prefers-reduced-motion: reduce) { .wire.active { animation: none; stroke-dasharray: none; } }
  .hit { fill: none; stroke: transparent; stroke-width: 16; cursor: pointer; }

  .spine { fill: rgba(28,22,17,0.06); stroke: rgba(28,22,17,0.45); stroke-width: 1.4; stroke-dasharray: 4 4; transition: fill 0.2s, stroke 0.2s; }
  .spine.lit { fill: rgba(177,69,94,0.08); stroke: #8a2d3a; stroke-dasharray: none; }
  .sp-t { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; fill: var(--ink, #1c1611); }
  .sp-sub { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.05em; fill: rgba(28,22,17,0.55); }
  .port { fill: rgba(28,22,17,0.25); }
  .port.on { fill: var(--wc); }

  .nd-r { fill: rgba(255,255,255,0.7); stroke: rgba(28,22,17,0.2); stroke-width: 1; }
  .nd.on .nd-r { stroke: var(--rc); stroke-width: 2.2; fill: #fff; }
  .nd.dim { opacity: 0.55; }
  .nd-t { font-family: 'DM Sans', sans-serif; font-size: 11.5px; fill: var(--ink, #1c1611); }
  .nd.on .nd-t { font-weight: 700; }

  /* detail */
  .sw-detail { margin-top: 14px; border: 1px solid rgba(28,22,17,0.16); border-left: 4px solid var(--sc); border-radius: 10px;
    background: rgba(255,255,255,0.55); padding: 13px 16px; }
  .swd-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .swd-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink, #1c1611); }
  .swd-pill { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #fff; padding: 2px 8px; border-radius: 4px; }
  .swd-via { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.55); border: 1px dashed rgba(28,22,17,0.3); border-radius: 4px; padding: 2px 7px; }
  .swd-move { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .swd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
  .swd-cell { border-left: 2px solid rgba(28,22,17,0.15); padding-left: 10px; }
  .swd-cell.exch { border-left-color: var(--sc); }
  .swd-k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); margin-bottom: 3px; }
  .swd-cell p { margin: 0 0 3px; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.78); }
  .swd-cell .g { color: #2f6f97; } .swd-cell .gb { color: #2f7d4f; }
</style>
