<script lang="ts">
  // A bespoke SVG diagram of the model's causal flow: policy levers (drivers) →
  // mediators → outcomes, with the key annotated edges (lag, strongest lever, weak
  // link, double-edged reform, 2028 cliff). Click any node or edge to inspect the
  // relationship — its mechanism, evidence, live value and the levers behind it.
  import { GROUP_META, LEVERS_BY_ID } from '../lib/levers';
  import { OUTCOMES_BY_ID } from '../lib/outcomes';
  import { app } from '../lib/appState.svelte';
  import { fmt, signed } from '../lib/chartkit';

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
    { id: 'd_p16',    label: 'Post-16 skills · Youth Guarantee · apprenticeships', col: 0, colour: g('post16') },
    { id: 'd_mh',     label: 'Youth mental-health support', col: 0, colour: g('post16') },
    { id: 'd_fund',   label: 'School & high-needs funding', col: 0, colour: g('macro') },
    // wider determinants & services (col 0)
    { id: 'd_pipeline', label: 'SEND specialist capacity', col: 0, colour: g('indirect') },
    { id: 'd_camhs',    label: 'CAMHS access', col: 0, colour: g('indirect') },
    { id: 'd_eal',      label: 'EAL / new-arrival support', col: 0, colour: g('indirect') },
    { id: 'd_care',     label: 'Care-experienced support', col: 0, colour: g('indirect') },
    { id: 'd_behave',   label: 'Inclusion & behaviour', col: 0, colour: g('indirect') },
    { id: 'd_place',    label: 'Place-based investment', col: 0, colour: g('indirect') },
    { id: 'd_tutor',    label: 'Catch-up tutoring', col: 0, colour: g('indirect') },
    { id: 'd_housing',  label: 'Housing instability', col: 0, colour: g('indirect') },
    // mediators (col 1)
    { id: 'm_pov',  label: 'Child poverty', col: 1, colour: INK },
    { id: 'm_abs',  label: 'Disadvantaged absence', col: 1, colour: INK },
    { id: 'm_cap',  label: 'Teacher capacity', col: 1, colour: INK },
    { id: 'm_ehcp', label: 'EHCP demand & inclusion', col: 1, colour: INK },
    { id: 'm_pipe', label: 'NEET pipeline', col: 1, colour: INK },
    // outcomes (col 2)
    { id: 'o_gap',  label: 'Disadvantage gap (KS4)', col: 2, colour: '#b1455e' },
    { id: 'o_att',  label: 'Attainment (A8 · KS2 · GLD)', col: 2, colour: '#2f6f97' },
    { id: 'o_send', label: 'SEND deficit · tribunals', col: 2, colour: '#7a5aa6' },
    { id: 'o_neet_u',  label: 'NEET — unemployed', col: 2, colour: '#2f6f97' },
    { id: 'o_neet_ih', label: 'NEET — inactive (health)', col: 2, colour: '#7a5aa6' },
    { id: 'o_neet_io', label: 'NEET — inactive (other)', col: 2, colour: '#9a7b1f' },
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
    // the NEET pipeline: upstream mediators feed the three segments
    { from: 'm_abs', to: 'm_pipe', label: 'risk-factor pipeline (DfE 2026)' },
    { from: 'm_pov', to: 'm_pipe' },
    { from: 'm_ehcp', to: 'm_pipe' },
    { from: 'm_pipe', to: 'o_neet_u' },
    { from: 'm_pipe', to: 'o_neet_ih', kind: 'risk', label: 'sticky stock + ill-health drift' },
    { from: 'm_pipe', to: 'o_neet_io' },
    { from: 'o_att', to: 'o_neet_u' },
    { from: 'd_p16', to: 'o_neet_u', kind: 'strong', label: 'work-route levers' },
    { from: 'd_mh', to: 'o_neet_ih' },
    { from: 'd_mh', to: 'm_abs', kind: 'weak' },
    { from: 'd_mh', to: 'm_ehcp', kind: 'weak' },
    // wider determinants & services
    { from: 'd_pipeline', to: 'm_abs' },   // supported SEND pupils attend more (pipelinePAcut)
    { from: 'd_pipeline', to: 'o_send' },  // provision adequacy → ehcp attainment, tribunals, deficit
    { from: 'd_camhs', to: 'm_abs' },      // severe-absence cut
    { from: 'd_camhs', to: 'm_ehcp', kind: 'weak' }, // damps SEMH EHCP demand
    { from: 'd_camhs', to: 'o_neet_ih' },
    { from: 'd_eal', to: 'o_att' },
    { from: 'd_care', to: 'o_send' },
    { from: 'd_care', to: 'o_neet_io' },
    { from: 'd_behave', to: 'm_abs' },     // severe-absence cut
    { from: 'd_behave', to: 'o_neet_u' },  // exclusion→AP→NEET pipeline
    { from: 'd_place', to: 'o_gap', kind: 'weak' },
    { from: 'd_place', to: 'o_neet_u' },
    { from: 'd_tutor', to: 'o_gap' },
    { from: 'd_housing', to: 'm_abs', kind: 'risk' },
    { from: 'd_housing', to: 'o_gap', kind: 'risk' },
  ];

  // ---- layout ----
  const W = 960, H = 860;
  const COLX = [188, 500, 812];   // node centres per column
  const COLW = [248, 168, 224];   // node widths per column
  const NH = 28;                   // node height
  const counts = [0, 1, 2].map((c) => nodes.filter((n) => n.col === c).length);
  function nodeY(col: Col, idx: number): number {
    const n = counts[col]; const top = 28, bot = 28; // full-height rows in every column
    return n === 1 ? H / 2 : top + (idx * (H - top - bot)) / (n - 1);
  }
  const idxInCol: Record<string, number> = {};
  for (const c of [0, 1, 2] as Col[]) nodes.filter((n) => n.col === c).forEach((n, i) => (idxInCol[n.id] = i));
  const pos: Record<string, { x: number; y: number; w: number; col: Col }> = {};
  for (const n of nodes) pos[n.id] = { x: COLX[n.col], y: nodeY(n.col, idxInCol[n.id]), w: COLW[n.col], col: n.col };

  // fan incoming edges across each target node's left edge so arrowheads don't stack;
  // the step is adaptive so the total spread always stays inside the box height (NH)
  const arrival: Record<string, number> = {};
  for (const target of nodes) {
    const inc = edges.filter((e) => e.to === target.id).sort((p, q) => pos[p.from].y - pos[q.from].y);
    const step = Math.min(7, (NH - 6) / Math.max(1, inc.length - 1));
    inc.forEach((e, i) => (arrival[e.from + '>' + e.to] = (i - (inc.length - 1) / 2) * step));
  }
  const isSkip = (e: Edge) => pos[e.to].col - pos[e.from].col >= 2;
  const wdrDivY = (pos.d_fund.y + pos.d_pipeline.y) / 2; // divider between core levers and wider determinants

  // Skip-edge labels would all pile up at the shared geometric midpoint; instead place each one at a
  // staggered parameter along its OWN arc so they spread horizontally and sit on their own line.
  const LABELED_SKIP = edges.filter((e) => e.label && isSkip(e));
  const skipLabelT: Record<string, number> = {};
  LABELED_SKIP.forEach((e, i) => {
    skipLabelT[e.from + '>' + e.to] = LABELED_SKIP.length < 2 ? 0.5 : 0.28 + (0.52 * i) / (LABELED_SKIP.length - 1);
  });
  function bez(e: Edge, t: number): { x: number; y: number } {
    const { x1, y1, x2, y2 } = endpoints(e);
    const dx = Math.max(40, (x2 - x1) * 0.45), lift = isSkip(e) ? 48 : 0;
    const mt = 1 - t, c1x = x1 + dx, c1y = y1 - lift, c2x = x2 - dx, c2y = y2 - lift;
    return {
      x: mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2,
      y: mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2,
    };
  }

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
    if (e.label && isSkip(e)) { const p = bez(e, skipLabelT[e.from + '>' + e.to] ?? 0.5); return { x: p.x, y: p.y - 7 }; }
    const { x1, y1, x2, y2 } = endpoints(e);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6 };
  }
  const strokeOf = (k?: string) => (k === 'risk' ? '#b1455e' : k === 'strong' ? '#2f7d4f' : k === 'weak' ? 'rgba(28,22,17,0.4)' : 'rgba(28,22,17,0.32)');
  const widthOf = (k?: string) => (k === 'strong' ? 2.4 : k === 'weak' ? 1.2 : 1.6);
  const dashOf = (k?: string) => (k === 'weak' || k === 'risk' ? '4 3' : 'none');
  const LEGEND: { kind: string; label: string; eg: string }[] = [
    { kind: 'strong', label: 'Strong, well-evidenced channel', eg: 'attendance → gap, teachers → attainment' },
    { kind: 'normal', label: 'Causal link', eg: 'standard modelled effect' },
    { kind: 'weak', label: 'Weak or lagged link', eg: '£→outcome, early-years 11-yr lag' },
    { kind: 'risk', label: 'Risk / cost edge', eg: 'double-edged EHCP reform, 2028 cliff' },
  ];

  let hover = $state<string | null>(null);
  // hover gives a quick isolate; a clicked node keeps it isolated (focus = hover, else selected node)
  function focusId(): string | null { return hover ?? (sel?.kind === 'node' ? sel.id : null); }
  function dim(nodeId: string): boolean {
    const f = focusId();
    if (!f) return false;
    if (f === nodeId) return false;
    return !edges.some((e) => (e.from === f && e.to === nodeId) || (e.to === f && e.from === nodeId));
  }
  function edgeActive(e: Edge): boolean { const f = focusId(); return !f || e.from === f || e.to === f; }

  // ---- interactivity: click a node or edge to inspect the relationship ----
  let sel = $state<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const eKey = (e: Edge) => e.from + '>' + e.to;
  const nodeOf = (id: string) => nodes.find((n) => n.id === id)!;
  const edgeOf = (key: string) => edges.find((e) => eKey(e) === key)!;
  function pickNode(id: string) { sel = sel?.kind === 'node' && sel.id === id ? null : { kind: 'node', id }; }
  function pickEdge(e: Edge) { const k = eKey(e); sel = sel?.kind === 'edge' && sel.id === k ? null : { kind: 'edge', id: k }; }
  const selNode = $derived(sel?.kind === 'node' ? sel.id : null);
  const selEdge = $derived(sel?.kind === 'edge' ? sel.id : null);

  // which levers each driver box represents (for jump-to-slider + live values)
  const NODE_LEVERS: Record<string, string[]> = {
    d_ey: ['ey_quality', 'ey_access', 'eypp'], d_pp: ['pupil_premium', 'fsm', 'breakfast'], d_pov: ['poverty_action'],
    d_att: ['attendance'], d_wf: ['teachers', 'teacher_pay', 'bursaries'], d_std: ['curriculum', 'reading', 'rise'],
    d_send: ['inclusion_fund', 'send_early'], d_reform: ['ehcp_reform'], d_p16: ['post16_skills', 'youth_guarantee', 'apprenticeships'],
    d_mh: ['mental_health'], d_fund: ['school_funding', 'high_needs'], d_pipeline: ['send_pipeline'], d_camhs: ['camhs'],
    d_eal: ['eal_support'], d_care: ['care_support'], d_behave: ['behaviour_support'], d_place: ['place_investment', 'mission_ne', 'mission_coastal'],
    d_tutor: ['tutoring'], d_housing: ['housing_instability'],
  };
  // mediator / outcome nodes → the YearResult field to show a LIVE value for
  const NODE_FIELD: Record<string, string> = {
    m_pov: 'childPoverty', m_abs: 'persistentAbsenceDis', m_cap: 'teacherShortfall', m_ehcp: 'ehcpPct',
    o_gap: 'gapKS4', o_att: 'attainment8', o_send: 'highNeedsDeficitStock',
    o_neet_u: 'neetUnemployed', o_neet_ih: 'neetInactiveHealth', o_neet_io: 'neetInactiveOther',
  };
  const NODE_INFO: Record<string, string> = {
    m_pov: 'Relative child poverty (AHC). An upstream mediator — it acts on the gap mainly through the home learning environment and attendance, so its effect is lagged.',
    m_abs: 'Disadvantaged persistent absence — the model\'s central hub. EPI attributes the entire post-2019 widening of the gap to this.',
    m_cap: 'Teacher capacity — recruitment, retention and TAs. The channel through which money (and pay/bursaries) reaches attainment; never a direct £→outcome term.',
    m_ehcp: 'EHCP demand & inclusion. Prevalence grows logistically; inclusion and early-SEND slow it; reform diverts to ISPs from 2030.',
    m_pipe: 'The NEET risk-factor pipeline (DfE 2026): absence, poverty and EHCP prevalence propagate into the 16–24 stock with a ~4-year lag.',
    o_gap: 'The headline equity metric — disadvantaged vs peers at GCSE, in EPI months of learning.',
    o_att: 'Attainment level (Attainment 8 / KS2 / GLD), all pupils.',
    o_send: 'The high-needs (DSG) deficit and tribunal volume — the SEND sub-system\'s stress signals.',
    o_neet_u: 'NEET — unemployed-active segment (cyclical). Moved by work-route levers.',
    o_neet_ih: 'NEET — inactive-health segment (sticky). Responds to mental-health/CAMHS, not job schemes.',
    o_neet_io: 'NEET — inactive-other segment (caring / discouraged).',
  };
  // richer text for the key edges (others fall back to a generated description)
  const EDGE_INFO: Record<string, string> = {
    'm_abs>o_gap': 'The strongest single relationship in the model. A pp rise in disadvantaged persistent absence adds ~0.077 months to the KS4 gap (EPI: the post-2019 widening is entirely absence-driven).',
    'm_cap>o_att': 'The evidenced attainment channel: teacher quality/supply ≈ 0.1–0.2 SD per SD of value-added (Chetty/Hanushek; NFER). This is why funding is routed through capacity.',
    'd_fund>o_att': 'Deliberately WEAK: the direct £-per-pupil → attainment link is near-zero at current spending in some studies (Hanushek/IFS) and positive in finance-reform studies (Jackson et al.). The model takes the cautious reading — funding acts via teacher capacity instead.',
    'd_pp>o_gap': 'Weak by design: there is no robust £→gap elasticity for the Pupil Premium (EEF; Gorard). Modelled as a quality-moderated offset with wide uncertainty.',
    'd_ey>o_gap': 'Early-years investment reaches GCSE only after the cohort ages ~11 years, with partial fade-out — a large but late effect.',
    'd_reform>o_send': 'Double-edged: EHCP reform cuts the deficit by diverting plans, but WITHOUT matching mainstream inclusion it lowers SEND attainment and raises tribunals.',
    'd_fund>o_send': 'The 2028 cliff: when the DSG statutory override ends (March 2028), any accumulated high-needs deficit is serviced from general funds, cutting mainstream per-pupil funding.',
    'd_p16>o_neet_u': 'Work-route levers (Youth Guarantee, apprenticeships, careers) act on the cyclical unemployed segment, cutting both inflow and persistence.',
    'm_pipe>o_neet_ih': 'The health segment is sticky and carries an exogenous youth-ill-health drift; it responds slowly and to different levers than the unemployed segment.',
    'm_abs>m_pipe': 'Persistent absence is the strongest NEET predictor (DfE 2026: ~3.9× relative risk), feeding the 16–24 stock with a lag.',
  };
  const KIND_MEANING: Record<string, string> = {
    strong: 'A strong, well-evidenced causal channel.',
    weak: 'A weak or lagged link — small, uncertain, or slow to arrive.',
    risk: 'A risk / cost edge — a downside or fiscal consequence, not a benefit.',
    normal: 'A standard modelled causal link.',
  };
  function liveValue(nodeId: string): { v: number; base: number; meta: any } | null {
    const field = NODE_FIELD[nodeId];
    if (!field) return null;
    const row = app.viewSim.find((y) => y.year === app.horizon) ?? app.viewSim[app.viewSim.length - 1];
    const brow = app.viewBase.find((y) => y.year === app.horizon) ?? app.viewBase[app.viewBase.length - 1];
    return { v: (row as any)[field], base: (brow as any)[field], meta: OUTCOMES_BY_ID[field] };
  }
  function edgeDesc(e: Edge): string {
    return EDGE_INFO[eKey(e)] ?? `${nodeOf(e.from).label} influences ${nodeOf(e.to).label}. ${KIND_MEANING[e.kind ?? 'normal']}`;
  }
  // edges connected to the selected node (for the "connected links" list)
  const connectedEdges = $derived(selNode ? edges.filter((e) => e.from === selNode || e.to === selNode) : []);
</script>

<figure class="cf">
  <div class="cf-scroll">
  <svg class="cf-diagram" viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Causal flow diagram of the model">
    <text x={COLX[0]} y="16" class="coltitle" text-anchor="middle">POLICY LEVERS</text>
    <text x={COLX[1]} y="16" class="coltitle" text-anchor="middle">MEDIATORS</text>
    <text x={COLX[2]} y="16" class="coltitle" text-anchor="middle">OUTCOMES</text>

    <line x1={COLX[0] - COLW[0] / 2} x2={COLX[0] + COLW[0] / 2} y1={wdrDivY} y2={wdrDivY} class="cf-div" />
    <text x={COLX[0] - COLW[0] / 2} y={wdrDivY - 4} class="cf-divlab">WIDER DETERMINANTS & SERVICES ↓</text>

    {#each edges as e (e.from + e.to)}
      {@const k = eKey(e)}
      <g class="edge" onclick={() => pickEdge(e)} style="cursor:pointer">
        <path d={edgePath(e)} fill="none" stroke="transparent" stroke-width="13" pointer-events="stroke" />
        <path d={edgePath(e)} fill="none" stroke={selEdge === k ? '#1c1611' : strokeOf(e.kind)}
              stroke-width={selEdge === k ? 3.2 : e.kind === 'strong' ? 2.4 : e.kind === 'weak' ? 1.2 : 1.6}
              stroke-dasharray={e.kind === 'weak' || e.kind === 'risk' ? '4 3' : 'none'}
              opacity={edgeActive(e) ? (selEdge === k ? 1 : 0.9) : 0.1} marker-end="url(#arrow)" pointer-events="none" />
      </g>
    {/each}
    {#each edges.filter((e) => e.label) as e (e.from + e.to + 'l')}
      {@const m = edgeMid(e)}
      <text x={m.x} y={m.y} class="elabel" class:risk={e.kind === 'risk'} class:strong={e.kind === 'strong'}
            text-anchor="middle" opacity={edgeActive(e) ? 1 : 0.12}>{e.label}</text>
    {/each}

    {#each nodes as n (n.id)}
      {@const p = pos[n.id]}
      <g class="node" opacity={dim(n.id) ? 0.22 : 1} role="button" tabindex="0"
         onpointerenter={() => (hover = n.id)} onpointerleave={() => (hover = null)}
         onclick={() => pickNode(n.id)}
         onkeydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickNode(n.id); } }}
         style="cursor:pointer">
        {#if selNode === n.id}
          <rect x={p.x - p.w / 2 - 3} y={p.y - NH / 2 - 3} width={p.w + 6} height={NH + 6} rx="9" fill="none" stroke="#1c1611" stroke-width="1" opacity="0.35" />
        {/if}
        <rect x={p.x - p.w / 2} y={p.y - NH / 2} width={p.w} height={NH} rx="7"
              fill={n.col === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.7)'}
              stroke={selNode === n.id ? '#1c1611' : n.colour} stroke-width={selNode === n.id ? 3 : n.col === 0 ? 1.5 : 1.8} />
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

  <div class="cf-insight" class:active={!!sel}>
    {#if sel?.kind === 'node'}
      {@const n = nodeOf(sel.id)}
      {@const lv = liveValue(sel.id)}
      {@const lvs = NODE_LEVERS[sel.id] ?? []}
      <div class="ci-head">
        <span class="ci-kind">{n.col === 0 ? 'Policy lever' : n.col === 1 ? 'Mediator' : 'Outcome'}</span>
        <span class="ci-title">{n.label}</span>
        <button class="ci-close" onclick={() => (sel = null)} aria-label="Close">✕</button>
      </div>
      {#if NODE_INFO[sel.id]}<p class="ci-desc">{NODE_INFO[sel.id]}</p>{/if}
      {#if lv}
        {@const d = lv.v - lv.base}
        {@const good = (lv.meta?.goodIfUp ? d : -d)}
        <div class="ci-live">
          <span class="ci-live-lab">Live · {app.horizon}</span>
          <span class="ci-live-v">{fmt(lv.v, lv.meta?.dp ?? 1)}<i>{lv.meta?.unit ?? ''}</i></span>
          {#if Math.abs(d) > 0.005}<span class="ci-live-d" style="color:{good > 0 ? '#2f7d4f' : '#b4455e'}">{signed(d, lv.meta?.dp ?? 1)} vs status quo</span>{/if}
        </div>
      {/if}
      {#if lvs.length}
        <div class="ci-levers"><span class="ci-lev-lab">Levers behind this</span>
          {#each lvs as id}<button class="ci-lev" onclick={() => app.focusLever(id)}>{LEVERS_BY_ID[id].label} ↗</button>{/each}
        </div>
      {/if}
      {#if connectedEdges.length}
        <div class="ci-conn"><span class="ci-lev-lab">Connected links</span>
          {#each connectedEdges as e}<button class="ci-conn-btn" onclick={() => pickEdge(e)}>{nodeOf(e.from).label} → {nodeOf(e.to).label}</button>{/each}
        </div>
      {/if}
    {:else if sel?.kind === 'edge'}
      {@const e = edgeOf(sel.id)}
      <div class="ci-head">
        <span class="ci-kind kind-{e.kind ?? 'normal'}">{e.kind ?? 'normal'} link</span>
        <span class="ci-title">{nodeOf(e.from).label} <span class="arr">→</span> {nodeOf(e.to).label}</span>
        <button class="ci-close" onclick={() => (sel = null)} aria-label="Close">✕</button>
      </div>
      <p class="ci-desc">{edgeDesc(e)}</p>
      {#if NODE_LEVERS[e.from]}
        <div class="ci-levers"><span class="ci-lev-lab">Tune this relationship</span>
          {#each NODE_LEVERS[e.from] as id}<button class="ci-lev" onclick={() => app.focusLever(id)}>{LEVERS_BY_ID[id].label} ↗</button>{/each}
        </div>
      {/if}
    {:else}
      <p class="ci-prompt">▸ Click any box or arrow to inspect the relationship — its mechanism, the evidence behind it, its live value, and the levers that move it.</p>
    {/if}
  </div>

  <figcaption>
    <span class="cf-legtitle">How to read the arrows</span>
    <div class="cf-legend">
      {#each LEGEND as l (l.kind)}
        <span class="lg">
          <svg class="sw" viewBox="0 0 34 12" width="34" height="12" aria-hidden="true">
            <line x1="1" y1="6" x2="26" y2="6" stroke={strokeOf(l.kind)} stroke-width={widthOf(l.kind)} stroke-dasharray={dashOf(l.kind)} />
            <path d="M25,2 L33,6 L25,10 z" fill={strokeOf(l.kind)} />
          </svg>
          <span class="lg-txt"><b>{l.label}</b><i>{l.eg}</i></span>
        </span>
      {/each}
    </div>
    <p class="cf-note">Driver boxes are tinted by policy-lever group. Arrows point from cause to effect. <b>Hover</b> to isolate a box's links; <b>click</b> any box or arrow to inspect the relationship.</p>
  </figcaption>
</figure>

<style>
  .cf { margin: 0; }
  .cf-scroll { overflow-x: auto; }
  /* scoped to the diagram ONLY — must not hit the small legend swatch <svg>s below */
  .cf-diagram { display: block; min-width: 760px; background: rgba(28,22,17,0.02); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); }
  .coltitle { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em; fill: rgba(28,22,17,0.45); }
  .cf-div { stroke: rgba(74,124,124,0.5); stroke-width: 1; stroke-dasharray: 3 3; }
  .cf-divlab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; fill: #4a7c7c; }
  .nlabel { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: var(--ink); }
  .elabel { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.55); }
  .elabel.risk { fill: #b1455e; }
  .elabel.strong { fill: #2f7d4f; }
  figcaption { margin-top: 10px; }
  .cf-legtitle { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: rgba(28,22,17,0.5); margin-bottom: 7px; }
  .cf-legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); gap: 10px 18px;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 11px 14px; }
  .lg { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
  .sw { flex: 0 0 34px; width: 34px; height: 12px; display: block; margin-top: 2px; }
  .lg-txt { display: flex; flex-direction: column; gap: 1px; line-height: 1.3; min-width: 0; }
  .lg-txt b { font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .lg-txt i { font-style: normal; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }
  .cf-note { margin: 9px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.6); }

  /* ---- click-to-inspect insight panel ---- */
  .cf-insight { margin-top: 10px; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 10px 12px; min-height: 52px; }
  .cf-insight.active { border-color: rgba(28,22,17,0.3); border-left: 3px solid #b4632e; background: rgba(255,255,255,0.6); }
  .ci-head { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; }
  .ci-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: rgba(28,22,17,0.6); padding: 2px 6px; border-radius: var(--radius-sharp); white-space: nowrap; }
  .ci-kind.kind-strong { background: var(--success); }
  .ci-kind.kind-weak { background: #9a7b1f; }
  .ci-kind.kind-risk { background: var(--error); }
  .ci-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); flex: 1; }
  .ci-title .arr { color: rgba(28,22,17,0.4); margin: 0 2px; }
  .ci-close { background: transparent; border: none; color: rgba(28,22,17,0.5); cursor: pointer; font-size: var(--fs-label); padding: 2px 4px; }
  .ci-close:hover { color: var(--ink); }
  .ci-desc { margin: 0 0 7px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.82); }
  .ci-live { display: inline-flex; align-items: baseline; gap: 9px; background: rgba(28,22,17,0.04); border-radius: var(--radius-sharp); padding: 4px 9px; margin-bottom: 7px; }
  .ci-live-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .ci-live-v { font-family: var(--fs-serif); font-size: 18px; font-weight: 600; color: var(--ink); }
  .ci-live-v i { font-style: normal; font-size: var(--fs-label-xs); opacity: 0.55; margin-left: 1px; }
  .ci-live-d { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; }
  .ci-levers, .ci-conn { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
  .ci-lev-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); margin-right: 2px; }
  .ci-lev { font-family: var(--font-body); font-size: var(--fs-label-xs); color: #b4632e; background: rgba(180,99,46,0.08); border: 1px solid rgba(180,99,46,0.3); border-radius: var(--radius-sharp); padding: 2px 8px; cursor: pointer; }
  .ci-lev:hover { background: rgba(180,99,46,0.16); }
  .ci-conn-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.7); background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.15); border-radius: var(--radius-sharp); padding: 2px 7px; cursor: pointer; }
  .ci-conn-btn:hover { background: rgba(28,22,17,0.1); }
  .ci-prompt { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.55); }
</style>
