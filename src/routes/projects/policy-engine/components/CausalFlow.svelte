<script lang="ts">
  // A bespoke SVG diagram of the model's causal flow: policy levers (drivers) →
  // mediators → outcomes, with the key annotated edges (lag, strongest lever, weak
  // link, double-edged reform, 2028 cliff). Self-contained; matches the warm palette.
  import { GROUP_META } from '../lib/levers';

  type Col = 0 | 1 | 2;
  interface Node { id: string; label: string; col: Col; colour: string; }
  interface Edge { from: string; to: string; kind?: 'normal' | 'strong' | 'weak' | 'risk'; label?: string; }

  const g = (k: string) => GROUP_META[k]?.colour ?? '#555';
  const INK = '#1c1611';

  const nodes: Node[] = [
    // drivers (col 0)
    { id: 'd_ey',     label: 'Early years', col: 0, colour: g('early') },
    { id: 'd_pp',     label: 'Pupil premium · FSM · breakfast', col: 0, colour: g('disadvantage') },
    { id: 'd_pov',    label: 'Child-poverty action', col: 0, colour: g('disadvantage') },
    { id: 'd_att',    label: 'Attendance mentors', col: 0, colour: g('attendance') },
    { id: 'd_wf',     label: 'Teachers · pay · bursaries', col: 0, colour: g('workforce') },
    { id: 'd_std',    label: 'Curriculum · reading · RISE', col: 0, colour: g('standards') },
    { id: 'd_send',   label: 'SEND inclusion · early ID', col: 0, colour: g('send') },
    { id: 'd_reform', label: 'EHCP reform', col: 0, colour: g('send') },
    { id: 'd_p16',    label: 'Post-16 · mental health', col: 0, colour: g('post16') },
    { id: 'd_fund',   label: 'School & high-needs funding', col: 0, colour: g('macro') },
    // mediators (col 1)
    { id: 'm_pov',  label: 'Child poverty', col: 1, colour: INK },
    { id: 'm_abs',  label: 'Disadvantaged absence', col: 1, colour: INK },
    { id: 'm_cap',  label: 'Teacher capacity', col: 1, colour: INK },
    { id: 'm_ehcp', label: 'EHCP demand & inclusion', col: 1, colour: INK },
    // outcomes (col 2)
    { id: 'o_gap',  label: 'Disadvantage gap (KS4)', col: 2, colour: '#b1455e' },
    { id: 'o_att',  label: 'Attainment (A8 · KS2 · GLD)', col: 2, colour: '#2f6f97' },
    { id: 'o_send', label: 'SEND deficit · tribunals', col: 2, colour: '#7a5aa6' },
    { id: 'o_neet', label: 'NEET (16–24)', col: 2, colour: '#5a6b3a' },
  ];

  const edges: Edge[] = [
    { from: 'd_pov', to: 'm_pov' },
    { from: 'd_pp', to: 'm_pov' },
    { from: 'd_pp', to: 'm_abs' },
    { from: 'd_pp', to: 'o_gap', kind: 'weak', label: 'weak £→gap link' },
    { from: 'm_pov', to: 'm_abs' },
    { from: 'm_pov', to: 'o_gap' },
    { from: 'd_att', to: 'm_abs' },
    { from: 'm_abs', to: 'o_gap', kind: 'strong', label: 'strongest lever (EPI)' },
    { from: 'm_abs', to: 'o_att' },
    { from: 'd_ey', to: 'o_gap', kind: 'weak', label: '~11-yr lag + fade-out' },
    { from: 'd_ey', to: 'o_att' },
    { from: 'd_wf', to: 'm_cap' },
    { from: 'd_wf', to: 'o_gap', kind: 'weak' },
    { from: 'm_cap', to: 'o_att', kind: 'strong', label: 'evidenced channel' },
    { from: 'd_fund', to: 'o_att', kind: 'weak', label: 'weak £→outcome' },
    { from: 'd_std', to: 'o_att' },
    { from: 'd_std', to: 'o_gap', kind: 'weak' },
    { from: 'd_send', to: 'm_ehcp' },
    { from: 'd_send', to: 'o_send' },
    { from: 'd_reform', to: 'm_ehcp' },
    { from: 'd_reform', to: 'o_send', kind: 'risk', label: 'double-edged' },
    { from: 'm_ehcp', to: 'o_send' },
    { from: 'd_fund', to: 'o_send', kind: 'risk', label: '2028 override cliff' },
    { from: 'o_att', to: 'o_neet' },
    { from: 'd_p16', to: 'o_neet' },
    { from: 'd_p16', to: 'm_ehcp', kind: 'weak' },
  ];

  // ---- layout ----
  const W = 960, H = 560;
  const COLX = [188, 500, 812];   // node centres per column
  const COLW = [248, 168, 224];   // node widths per column
  const NH = 30;                   // node height
  const counts = [0, 1, 2].map((c) => nodes.filter((n) => n.col === c).length);
  function nodeY(col: Col, idx: number): number {
    const n = counts[col]; const top = 34, bot = 34;
    return n === 1 ? H / 2 : top + (idx * (H - top - bot)) / (n - 1);
  }
  const idxInCol: Record<string, number> = {};
  for (const c of [0, 1, 2] as Col[]) nodes.filter((n) => n.col === c).forEach((n, i) => (idxInCol[n.id] = i));
  const pos: Record<string, { x: number; y: number; w: number; col: Col }> = {};
  for (const n of nodes) pos[n.id] = { x: COLX[n.col], y: nodeY(n.col, idxInCol[n.id]), w: COLW[n.col], col: n.col };

  // fan incoming edges across each target node's left edge so arrowheads don't stack
  const arrival: Record<string, number> = {};
  for (const target of nodes) {
    const inc = edges.filter((e) => e.to === target.id).sort((p, q) => pos[p.from].y - pos[q.from].y);
    inc.forEach((e, i) => (arrival[e.from + '>' + e.to] = (i - (inc.length - 1) / 2) * 7));
  }
  const isSkip = (e: Edge) => pos[e.to].col - pos[e.from].col >= 2;

  function endpoints(e: Edge) {
    const a = pos[e.from], b = pos[e.to];
    return { x1: a.x + a.w / 2, y1: a.y, x2: b.x - b.w / 2, y2: b.y + (arrival[e.from + '>' + e.to] || 0) };
  }
  function edgePath(e: Edge): string {
    const { x1, y1, x2, y2 } = endpoints(e);
    const dx = Math.max(40, (x2 - x1) * 0.45);
    const lift = isSkip(e) ? 48 : 0; // arc col0→col2 skip-edges OVER the mediator band
    return `M${x1},${y1} C${x1 + dx},${y1 - lift} ${x2 - dx},${y2 - lift} ${x2},${y2}`;
  }
  function edgeMid(e: Edge): { x: number; y: number } {
    const { x1, y1, x2, y2 } = endpoints(e);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - (isSkip(e) ? 42 : 6) };
  }
  const strokeOf = (k?: string) => (k === 'risk' ? '#b1455e' : k === 'strong' ? '#2f7d4f' : k === 'weak' ? 'rgba(28,22,17,0.4)' : 'rgba(28,22,17,0.32)');

  let hover = $state<string | null>(null);
  function dim(nodeId: string): boolean {
    if (!hover) return false;
    if (hover === nodeId) return false;
    return !edges.some((e) => (e.from === hover && e.to === nodeId) || (e.to === hover && e.from === nodeId));
  }
  function edgeActive(e: Edge): boolean { return !hover || e.from === hover || e.to === hover; }
</script>

<figure class="cf">
  <div class="cf-scroll">
  <svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Causal flow diagram of the model">
    <text x={COLX[0]} y="16" class="coltitle" text-anchor="middle">POLICY LEVERS</text>
    <text x={COLX[1]} y="16" class="coltitle" text-anchor="middle">MEDIATORS</text>
    <text x={COLX[2]} y="16" class="coltitle" text-anchor="middle">OUTCOMES</text>

    {#each edges as e (e.from + e.to)}
      <path d={edgePath(e)} fill="none" stroke={strokeOf(e.kind)}
            stroke-width={e.kind === 'strong' ? 2.4 : e.kind === 'weak' ? 1.2 : 1.6}
            stroke-dasharray={e.kind === 'weak' || e.kind === 'risk' ? '4 3' : 'none'}
            opacity={edgeActive(e) ? 0.9 : 0.12} marker-end="url(#arrow)" />
    {/each}
    {#each edges.filter((e) => e.label) as e (e.from + e.to + 'l')}
      {@const m = edgeMid(e)}
      <text x={m.x} y={m.y} class="elabel" class:risk={e.kind === 'risk'} class:strong={e.kind === 'strong'}
            text-anchor="middle" opacity={edgeActive(e) ? 1 : 0.12}>{e.label}</text>
    {/each}

    {#each nodes as n (n.id)}
      {@const p = pos[n.id]}
      <g opacity={dim(n.id) ? 0.25 : 1} onpointerenter={() => (hover = n.id)} onpointerleave={() => (hover = null)} style="cursor:default">
        <rect x={p.x - p.w / 2} y={p.y - NH / 2} width={p.w} height={NH} rx="7"
              fill={n.col === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.7)'}
              stroke={n.colour} stroke-width={n.col === 0 ? 1.5 : 1.8} />
        {#if n.col === 0}<rect x={p.x - p.w / 2} y={p.y - NH / 2} width="4" height={NH} rx="2" fill={n.colour} />{/if}
        <text x={p.x} y={p.y + 3.5} class="nlabel" text-anchor="middle">{n.label}</text>
      </g>
    {/each}

    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="rgba(28,22,17,0.7)" />
      </marker>
    </defs>
  </svg>
  </div>
  <figcaption>
    Solid green = the strongest, best-evidenced channels (attendance, teacher capacity). Dashed = weak or
    lagged links (the £→outcome elasticity, early-years cohort lag). Red dashed = a risk/cost edge (EHCP
    reform is double-edged; the SEND deficit hits the 2028 override cliff). Hover a box to isolate its links.
  </figcaption>
</figure>

<style>
  .cf { margin: 0; }
  .cf-scroll { overflow-x: auto; }
  svg { display: block; min-width: 760px; background: rgba(28,22,17,0.02); border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; }
  .coltitle { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; fill: rgba(28,22,17,0.45); }
  .nlabel { font-family: 'DM Sans', system-ui, sans-serif; font-size: 11px; fill: var(--ink, #1c1611); }
  .elabel { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(28,22,17,0.55); }
  .elabel.risk { fill: #b1455e; }
  .elabel.strong { fill: #2f7d4f; }
  figcaption { margin-top: 7px; font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.6); }
</style>
