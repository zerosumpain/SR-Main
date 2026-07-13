<script lang="ts">
  // EdgeNodeDiagram — Figure 2 rebuilt: the anatomy of a single participant.
  // Source system → connector (the trust boundary) → national fabric. Every
  // block is clickable; the three boundary crossings animate continuously.
  import { EDGE_PARTS, type EdgePart } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  let selected = $state<EdgePart | null>(EDGE_PARTS.find((p) => p.id === 'pep') ?? null);

  const connectorParts = EDGE_PARTS.filter((p) => p.panel === 'connector');
  const fabricParts = EDGE_PARTS.filter((p) => p.panel === 'fabric');
  const src = EDGE_PARTS.find((p) => p.id === 'src')!;

  interface Box { x: number; y: number; w: number; h: number }
  const conBox = (i: number): Box => ({ x: i % 2 === 0 ? 355 : 575, y: 150 + Math.floor(i / 2) * 112, w: 195, h: 96 });
  const fabBox = (i: number): Box => ({ x: 900, y: 150 + i * 70, w: 200, h: 56 });

  function pick(p: EdgePart) {
    selected = selected?.id === p.id ? null : p;
  }
  function onKey(e: KeyboardEvent, p: EdgePart) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p); }
  }
</script>

<div class="edge">
  <div class="diagram-scroll">
    <svg viewBox="0 0 1150 570" role="img" aria-label="Anatomy of an edge node: the source system keeps the pupil records; the connector is the trust boundary; the national fabric provides catalogue, consent, policy, ledger and identity services.">
      <!-- source panel -->
      <rect class="panel" x="30" y="90" width="230" height="380" rx="10" />
      <text class="p-title" x="145" y="120" text-anchor="middle">SOURCE SYSTEM</text>
      <text class="p-sub" x="145" y="138" text-anchor="middle">Arbor · ESS SIMS · Bromcom</text>
      <text class="p-sub" x="145" y="152" text-anchor="middle">IRIS Ed:gen · LA case system</text>
      <g class="part" class:sel={selected?.id === 'src'} role="button" tabindex="0" aria-label="Pupil-level records — details"
         onclick={() => pick(src)} onkeydown={(e) => onKey(e, src)}>
        <rect class="pbox" x="55" y="190" width="180" height="110" rx="8" />
        <text class="plab" x="145" y="235" text-anchor="middle">Pupil-level records</text>
        <text class="psub" x="145" y="256" text-anchor="middle">they remain here</text>
      </g>
      <text class="p-note" x="145" y="420" text-anchor="middle">owned &amp; controlled by</text>
      <text class="p-note" x="145" y="436" text-anchor="middle">the school / MAT / LA</text>

      <!-- connector panel: the trust boundary -->
      <rect class="panel strong" x="330" y="70" width="465" height="430" rx="10" />
      <text class="p-title strong-t" x="562" y="100" text-anchor="middle">CONNECTOR — the trust boundary</text>
      <text class="p-sub" x="562" y="118" text-anchor="middle">the same open-source build for every participant · e.g. Eclipse Dataspace Components</text>
      {#each connectorParts as p, i (p.id)}
        {@const b = conBox(i)}
        <g class="part" class:sel={selected?.id === p.id} class:ok={p.tone === 'ok'} class:hot={p.tone === 'hot'} class:ledger={p.tone === 'ledger'}
           role="button" tabindex="0" aria-label="{p.label} — details" onclick={() => pick(p)} onkeydown={(e) => onKey(e, p)}>
          <rect class="pbox" x={b.x} y={b.y} width={b.w} height={b.h} rx="8" />
          <text class="plab" x={b.x + b.w / 2} y={b.y + 40} text-anchor="middle">{p.label}</text>
          <text class="psub" x={b.x + b.w / 2} y={b.y + 60} text-anchor="middle">{p.sub}</text>
        </g>
      {/each}

      <!-- fabric panel -->
      <rect class="panel dashed" x="880" y="70" width="240" height="430" rx="10" />
      <text class="p-title" x="1000" y="100" text-anchor="middle">NATIONAL FABRIC</text>
      <text class="p-sub" x="1000" y="118" text-anchor="middle">DfE-run · brokers only</text>
      {#each fabricParts as p, i (p.id)}
        {@const b = fabBox(i)}
        <g class="part" class:sel={selected?.id === p.id} role="button" tabindex="0" aria-label="{p.label} — details"
           onclick={() => pick(p)} onkeydown={(e) => onKey(e, p)}>
          <rect class="pbox" x={b.x} y={b.y} width={b.w} height={b.h} rx="8" />
          <text class="plab" x={b.x + b.w / 2} y={b.y + 24} text-anchor="middle">{p.label}</text>
          <text class="psub" x={b.x + b.w / 2} y={b.y + 42} text-anchor="middle">{p.sub}</text>
        </g>
      {/each}

      <!-- boundary crossings -->
      <g class="arrows">
        <path id="edge-read" class="arrow" d="M 262 245 H 328" />
        <text class="a-lab" x="295" y="236" text-anchor="middle">read in situ</text>
        <circle r="4" class="dot ink"><animateMotion dur="2.2s" repeatCount="indefinite" path="M 262 245 H 328" /></circle>

        <path id="edge-signed" class="arrow" d="M 797 205 H 878" />
        <text class="a-lab" x="838" y="196" text-anchor="middle">signed →</text>
        <circle r="4" class="dot ok"><animateMotion dur="2s" repeatCount="indefinite" path="M 797 205 H 878" /></circle>

        <path id="edge-queries" class="arrow" d="M 878 330 H 797" />
        <text class="a-lab" x="838" y="321" text-anchor="middle">← queries</text>
        <circle r="4" class="dot query"><animateMotion dur="2s" begin="0.7s" repeatCount="indefinite" path="M 878 330 H 797" /></circle>
      </g>

      <text class="boundary" x="562" y="534" text-anchor="middle">⟨ default-deny — data crosses only as a no-PII aggregate, an approved point-to-point transfer, or a rule-triggered PII release ⟩</text>
    </svg>
  </div>

  {#if selected}
    <aside class="inspector">
      <button class="close" onclick={() => (selected = null)} aria-label="Close">✕</button>
      <span class="ins-kicker">{selected.panel === 'source' ? 'source system · the controller' : selected.panel === 'connector' ? 'inside the connector' : 'national fabric service'}</span>
      <h4>{selected.label} <em>· {selected.sub}</em></h4>
      <p>{selected.desc}</p>
    </aside>
  {:else}
    <p class="hint">{eli ? 'Tap any box to see what it does.' : 'Click any block for its role, exemplar and standards.'}</p>
  {/if}
</div>

<style>
  .edge { border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round); background: var(--surface-elevated, #e8dece); overflow: hidden; }
  .diagram-scroll { overflow-x: auto; }
  svg { display: block; min-width: 820px; width: 100%; height: auto; }

  .panel { fill: rgba(255,255,255,0.55); stroke: rgba(26,16,8,0.4); stroke-width: 1.2; }
  .panel.strong { stroke: var(--accent-ink, #0e5b66); stroke-width: 2; fill: rgba(14,91,102,0.08); }
  .panel.dashed { stroke-dasharray: 6 5; }
  .p-title { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.16em; fill: rgba(26,16,8,0.78); font-weight: 600; }
  .p-title.strong-t { fill: var(--accent-ink); }
  .p-sub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; fill: rgba(26,16,8,0.72); }
  .p-note { font-family: 'DM Sans', sans-serif; font-size: 11px; font-style: italic; fill: rgba(26,16,8,0.72); }

  .part { cursor: pointer; }
  .pbox { fill: #ffffff; stroke: rgba(26,16,8,0.55); stroke-width: 1.4; transition: stroke 0.12s, fill 0.12s; }
  .part:hover .pbox { stroke: rgba(26,16,8,0.9); }
  .part.sel .pbox { stroke: var(--accent-ink); stroke-width: 2.5; fill: #dce9e4; }
  .part.ok .pbox { stroke: #2f7d4f; stroke-width: 1.5px; fill: rgba(47,125,79,0.10); }
  .part.hot .pbox { stroke: var(--accent, #c4570a); stroke-width: 1.6px; fill: rgba(196,87,10,0.10); }
  .part.ledger .pbox { stroke: #a8842a; stroke-width: 1.5px; fill: rgba(176,137,42,0.10); }
  .part:focus-visible .pbox { stroke: var(--accent-ink); stroke-width: 2.5; }
  .plab { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; fill: var(--ink); }
  .psub { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em; fill: rgba(26,16,8,0.72); }

  .arrow { fill: none; stroke: rgba(26,16,8,0.6); stroke-width: 1.6; }
  .a-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em; fill: rgba(26,16,8,0.72); }
  .dot.ink { fill: #1c2f4a; }
  .dot.ok { fill: #2f7d4f; }
  .dot.query { fill: var(--accent-ink); }
  .boundary { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.04em; fill: #9a3f08; font-weight: 600; }

  .inspector { position: relative; margin: 14px 20px 18px; border: 1.5px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-round); background: #ffffff; padding: 14px 18px; }
  .inspector .close { position: absolute; top: 8px; right: 12px; background: none; border: none; color: rgba(26,16,8,0.55); cursor: pointer; font-size: 13px; }
  .inspector .close:hover { color: var(--ink); }
  .ins-kicker { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent-ink); }
  .inspector h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; margin: 3px 0 6px; color: var(--ink); }
  .inspector h4 em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(26,16,8,0.6); }
  .inspector p { font-size: 13px; line-height: 1.55; color: rgba(26,16,8,0.85); margin: 0; }
  .hint { font-size: 12px; font-style: italic; color: rgba(26,16,8,0.62); margin: 12px 20px 16px; }
</style>
