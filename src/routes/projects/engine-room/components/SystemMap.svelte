<script lang="ts">
  // SystemMap — the whole architecture in one frame, six bands deep.
  //
  // Layout note (2026-08-10): the band label used to sit in a 112px left gutter with the
  // band's blurb underneath it. The blurb had no width to live in, so it ran straight under
  // the first two columns of boxes and read as a printing fault. Bands now carry a
  // FULL-WIDTH HEADER ROW of their own — number, name, then the blurb — and the boxes start
  // on a clean line beneath it. Nothing overlaps because nothing shares a row any more.
  //
  // The interaction is the point: with nothing hovered the flows sit faint and you read the
  // shape. Hover any box and only its own connections light up, so you can trace one path
  // through six layers without a hairball of nineteen crossing lines. Hovering a box that
  // has a section also raises a card saying, in words, what clicking it will open — the dot
  // alone never told anyone that.
  //
  // Rendering rules (svelte5-pitfalls §1): no timers held in $state; structure always drawn.
  import { goto } from '$app/navigation';
  import { BANDS, NODES, FLOWS, type MapNode } from '../lib/system';
  import { PARTS } from '../lib/nav';
  import { app } from '../lib/appState.svelte';

  let hover = $state<string | null>(null);
  const eli = $derived(app.narrative === 'eli5');

  // ---- geometry (viewBox 1000 × H) ----------------------------------------
  const W = 1000;
  const PAD = 10;
  const COLS = 8;
  const GAP = 8;
  const COLW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const HEAD_H = 22;   // the band's own label row
  const NH = 42;       // a node box
  const BAND_PAD = 9;  // breathing room under the boxes
  const BAND_H = HEAD_H + NH + BAND_PAD;
  const TOP = 4;

  const bandY = (i: number) => TOP + i * BAND_H;
  const bandIdx = (b: string) => BANDS.findIndex((x) => x.id === b);
  /** Boxes sit under their band's header row. */
  const nodeY = (n: MapNode) => bandY(bandIdx(n.band)) + HEAD_H;
  const nodeX = (n: MapNode) => PAD + n.col * (COLW + GAP);
  const nodeW = (n: MapNode) => (n.span ?? 1) * COLW + ((n.span ?? 1) - 1) * GAP;
  const nodeCx = (n: MapNode) => nodeX(n) + nodeW(n) / 2;
  const H = TOP + BANDS.length * BAND_H + 24;

  const byId = new Map(NODES.map((n) => [n.id, n]));

  // Which nodes are connected to the hovered one (either direction)?
  const lit = $derived.by(() => {
    if (!hover) return null;
    const s = new Set<string>([hover]);
    for (const f of FLOWS) {
      if (f.from === hover) s.add(f.to);
      if (f.to === hover) s.add(f.from);
    }
    return s;
  });

  const flowLit = (f: { from: string; to: string }) => !!hover && (f.from === hover || f.to === hover);
  const nodeDim = (id: string) => !!lit && !lit.has(id);

  /** Cubic bezier between two node boxes, leaving from the lower edge and arriving at the upper. */
  function path(f: { from: string; to: string }): string {
    const a = byId.get(f.from);
    const b = byId.get(f.to);
    if (!a || !b) return '';
    const ay = nodeY(a);
    const by = nodeY(b);
    const down = by > ay;
    const y1 = down ? ay + NH : ay;
    const y2 = down ? by : by + NH;
    const x1 = nodeCx(a);
    const x2 = nodeCx(b);
    const dy = Math.abs(y2 - y1);
    const c = Math.max(18, dy * 0.45);
    return `M ${x1} ${y1} C ${x1} ${down ? y1 + c : y1 - c}, ${x2} ${down ? y2 - c : y2 + c}, ${x2} ${y2}`;
  }

  const hoveredNode = $derived(hover ? byId.get(hover) ?? null : null);

  /**
   * `part/slug` → the leaf it opens, so the hover card can promise something specific.
   * "A dot means that box has a section" told a reader nothing about what they would get.
   */
  function destination(section?: string) {
    if (!section) return null;
    const [partId, slug] = section.split('/');
    const part = PARTS.find((p) => p.id === partId);
    const leaf = part?.leaves.find((l) => l.slug === slug);
    if (!part || !leaf) return null;
    return { part, leaf };
  }
  const dest = $derived(destination(hoveredNode?.section));

  /**
   * Card geometry: pinned above the box, or below it when the box is near the top.
   *
   * A foreignObject clips rather than grows, so the height is estimated from the text
   * instead of fixed — a fixed 84px silently ate the last line of the longer entries.
   */
  const CARD_W = 344;
  const CPL = Math.floor((CARD_W - 26) / 5.35); // ≈ characters per line at 10.5px DM Sans
  const lines = (s: string) => Math.max(1, Math.ceil(s.length / CPL));
  const cardH = $derived.by(() => {
    if (!hoveredNode) return 0;
    const what = lines(hoveredNode.what);
    const go = dest
      ? lines(`Click to read ${dest.leaf.label} — ${dest.leaf.blurb}`)
      : 1;
    return 30 + what * 15 + 7 + go * 15 + 12;
  });
  const cardX = $derived(
    hoveredNode ? Math.min(Math.max(nodeCx(hoveredNode) - CARD_W / 2, PAD), W - PAD - CARD_W) : 0,
  );
  const cardAbove = $derived(hoveredNode ? nodeY(hoveredNode) > cardH + 16 : true);
  const cardY = $derived(
    hoveredNode ? (cardAbove ? nodeY(hoveredNode) - cardH - 9 : nodeY(hoveredNode) + NH + 9) : 0,
  );

  function open(n: MapNode) {
    if (n.section) goto(`/projects/engine-room/${n.section}`);
  }
</script>

<div class="sm">
  <div class="sm-scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="The system as six stacked bands: surfaces, engines, reasoning, memory, the outside world, and the infrastructure it runs on. Boxes are components; curves are the flows between them.">

      <!-- ---- band backgrounds + their own full-width label rows ---- -->
      {#each BANDS as b, i}
        {@const y = bandY(i)}
        <rect x="0" y={y} width={W} height={BAND_H - 5} rx="7" class="band" class:alt={i % 2 === 1} />
        <text x={PAD} y={y + 15} class="band-lab">
          <tspan class="band-no">{b.no}</tspan>
          <tspan class="band-name" dx="8">{eli ? b.eli5Name : b.name}</tspan>
          <tspan class="band-blurb" dx="10">{eli ? b.eli5Blurb : b.blurb}</tspan>
        </text>
      {/each}

      <!-- ---- flows, drawn behind the boxes ---- -->
      <g class="flows">
        {#each FLOWS as f}
          <path d={path(f)} class="flow" class:lit={flowLit(f)} class:dim={!!hover && !flowLit(f)} />
        {/each}
      </g>

      <!-- ---- nodes ---- -->
      {#each NODES as n}
        {@const x = nodeX(n)}
        {@const y = nodeY(n)}
        {@const w = nodeW(n)}
        <g class="node" class:key={n.key} class:on={hover === n.id} class:dim={nodeDim(n.id)}
           class:clickable={!!n.section}
           role="button" tabindex="0"
           aria-label="{n.label} — {n.what}{n.section ? '. Opens ' + (destination(n.section)?.leaf.label ?? n.section) + '.' : ''}"
           onmouseenter={() => (hover = n.id)}
           onmouseleave={() => (hover = null)}
           onfocus={() => (hover = n.id)}
           onblur={() => (hover = null)}
           onclick={() => open(n)}
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n); } }}>
          <rect {x} {y} width={w} height={NH} rx="6" class="nbox" />
          <text x={x + w / 2} y={y + NH / 2 + 4} text-anchor="middle" class="nlabel">{n.label}</text>
          {#if n.section}
            <circle cx={x + w - 9} cy={y + 9} r="2.4" class="ndot" />
          {/if}
        </g>
      {/each}

      <!--
        The hover card. Drawn last so it sits above everything, and pointer-events off so
        moving toward it never steals the hover from the box that raised it.
      -->
      {#if hoveredNode}
        <g class="card" transform="translate({cardX},{cardY})">
          <rect width={CARD_W} height={cardH} rx="7" class="card-bg" />
          <text x="13" y="20" class="card-label">{hoveredNode.label}</text>
          <foreignObject x="13" y="26" width={CARD_W - 26} height={cardH - 30}>
            <div class="card-body" xmlns="http://www.w3.org/1999/xhtml">
              <p class="cb-what">{hoveredNode.what}</p>
              {#if dest}
                <p class="cb-go">
                  <span class="cb-arrow">→</span>
                  Click to read <b>{dest.leaf.label}</b> — {dest.leaf.blurb.toLowerCase()}
                </p>
              {:else}
                <p class="cb-none">No page of its own — it turns up inside the others.</p>
              {/if}
            </div>
          </foreignObject>
        </g>
      {/if}

      <text x={PAD} y={H - 7} class="key-note">
        HOVER A BOX TO LIGHT ITS CONNECTIONS · A DOT MEANS THAT BOX OPENS A CHAPTER
      </text>
    </svg>
  </div>
</div>

<style>
  .sm { margin: 6px 0; }
  .sm-scroll { overflow-x: auto; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round);
    background: rgba(255,255,255,0.4); padding: 8px 10px; }
  .sm-scroll svg { display: block; min-width: 920px; width: 100%; height: auto; }

  .band { fill: rgba(28,22,17,0.028); }
  .band.alt { fill: rgba(28,22,17,0.055); }

  /* One text node, three tspans — so the blurb always flows AFTER the name and can never
     be positioned into the same space as a box. */
  .band-lab { font-family: 'DM Sans', sans-serif; }
  .band-no { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; fill: var(--accent-ink); }
  .band-name { font-size: 12px; font-weight: 600; fill: #1c1611; letter-spacing: 0.01em; }
  .band-blurb { font-size: 9.5px; fill: rgba(28,22,17,0.45); }

  .flow { fill: none; stroke: var(--accent-ink); stroke-width: 1.1; opacity: 0.13; transition: opacity 0.15s, stroke-width 0.15s; }
  .flow.lit { opacity: 0.8; stroke-width: 2; }
  .flow.dim { opacity: 0.035; }

  .node { transition: opacity 0.15s; }
  .node.clickable { cursor: pointer; }
  .node.dim { opacity: 0.3; }
  .nbox { fill: rgba(255,255,255,0.86); stroke: rgba(28,22,17,0.2); stroke-width: 1; transition: fill 0.14s, stroke 0.14s; }
  .node.key .nbox { fill: #fdfbf6; stroke: rgba(28,22,17,0.42); stroke-width: 1.5; }
  .node.on .nbox { fill: var(--accent-ink); stroke: var(--accent-ink); }
  .nlabel { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 500; fill: #1c1611; transition: fill 0.14s; }
  .node.key .nlabel { font-weight: 600; }
  .node.on .nlabel { fill: #fff; }
  .ndot { fill: var(--accent); opacity: 0.8; }
  .node.on .ndot { fill: #fff; }
  .node:focus { outline: none; }
  .node:focus-visible .nbox { stroke: var(--accent); stroke-width: 2.5; }

  .card { pointer-events: none; }
  .card-bg { fill: #1c1611; opacity: 0.96; }
  .card-label { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; fill: #fdfbf6; }
  .card-body { font-family: 'DM Sans', sans-serif; color: rgba(253,251,246,0.72); }
  .card-body p { margin: 0; }
  .cb-what { font-size: 10.5px; line-height: 1.42; }
  .cb-go { margin-top: 5px !important; font-size: 10.5px; line-height: 1.42; color: #f0c98a; }
  .cb-go b { color: #fdfbf6; font-weight: 600; }
  .cb-arrow { opacity: 0.75; }
  .cb-none { margin-top: 5px !important; font-size: 10px; font-style: italic; color: rgba(253,251,246,0.45); }

  .key-note { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.08em; fill: rgba(28,22,17,0.4); }
</style>
