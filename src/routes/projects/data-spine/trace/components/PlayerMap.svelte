<script lang="ts">
  // PlayerMap — the simple picture, and the one that should be understood first.
  //
  // Who is actually involved, and what passes between them. Only the players this
  // scenario touches are drawn, so a safeguarding disclosure and a national statistic
  // are visibly different shapes rather than the same diagram with different labels.
  //
  // It shares the parent's scenario AND its active stage, so as the trace plays the
  // corresponding hop lights here. Detail lives in the grid below; this is the map.
  import { PLAYERS, STAGES, type Scenario, type StageId } from '../lib/trace';

  // The dots loop continuously rather than following the parent's play/pause: the map
  // is illustrating "this is the hop that is happening", and it should keep saying so
  // while the reader is paused and actually looking at it.
  interface Props { scenario: Scenario; active: number }
  let { scenario, active }: Props = $props();

  const on = $derived(new Set(scenario.players));
  const shown = $derived(PLAYERS.filter((p) => on.has(p.id)));
  const edges = $derived(shown.filter((p) => p.kind === 'edge'));
  const requester = $derived(shown.find((p) => p.kind === 'requester'));
  const answer = $derived(shown.find((p) => p.kind === 'answer'));
  const activeStage = $derived<StageId>(STAGES[active].id);

  // ---- geometry (viewBox 1000 × 330) --------------------------------------
  const W = 1000, H = 330;
  const REQ = { x: 24, y: 30, w: 208, h: 74 };
  const SPINE = { x: 356, y: 18, w: 288, h: 98 };
  const LEDGER = { x: 40, y: 152, w: 196, h: 48 };
  const ANS = { x: 768, y: 30, w: 208, h: 74 };
  const EDGE_Y = 236, EDGE_H = 72, EDGE_GAP = 12;

  const edgeBox = (i: number) => {
    const n = Math.max(1, edges.length);
    const w = Math.min(190, (W - 48 - EDGE_GAP * (n - 1)) / n);
    const total = n * w + EDGE_GAP * (n - 1);
    const x0 = (W - total) / 2;
    return { x: x0 + i * (w + EDGE_GAP), y: EDGE_Y, w, h: EDGE_H };
  };

  const spineCx = SPINE.x + SPINE.w / 2;
  const spineBottom = SPINE.y + SPINE.h;

  /** spine → one estate, and back up the same line */
  const legPath = (i: number) => {
    const b = edgeBox(i);
    const cx = b.x + b.w / 2;
    return `M ${spineCx} ${spineBottom} C ${spineCx} ${spineBottom + 60}, ${cx} ${EDGE_Y - 60}, ${cx} ${EDGE_Y}`;
  };
  const askPath = `M ${REQ.x + REQ.w} ${REQ.y + REQ.h / 2} L ${SPINE.x} ${SPINE.y + SPINE.h / 2}`;
  const ansPath = `M ${SPINE.x + SPINE.w} ${SPINE.y + SPINE.h / 2} L ${ANS.x} ${ANS.y + ANS.h / 2}`;
  const logPath = `M ${SPINE.x + 24} ${spineBottom} C ${SPINE.x - 60} ${spineBottom + 34}, ${LEDGER.x + LEDGER.w + 60} ${LEDGER.y - 6}, ${LEDGER.x + LEDGER.w} ${LEDGER.y + LEDGER.h / 2}`;

  // which hop is live at each stage
  const liveAsk = $derived(activeStage === 'commission');
  const liveLog = $derived(activeStage === 'ledger');
  const liveConsent = $derived(activeStage === 'consent');
  const liveDown = $derived(activeStage === 'mis');
  const liveUp = $derived(activeStage === 'aggregate');
  const liveAns = $derived(activeStage === 'answer');
  const pii = $derived(scenario.result.kind === 'pii');

  const CAPTION: Record<StageId, string> = {
    commission: 'The question travels to the small service in the middle.',
    ledger: 'Before anything runs, the ask is written down permanently.',
    consent: 'The rules are checked — including anyone who has said no.',
    mis: 'The question goes out to each holder. The records do not move.',
    aggregate: 'Only totals come back, and get added up.',
    answer: 'The answer goes to whoever asked — with its receipt.',
  };
</script>

<div class="pm">
  <div class="pm-head">
    <span class="pm-lab">THE SIMPLE PICTURE · WHO IS INVOLVED IN <b>THIS</b> SCENARIO</span>
    <span class="pm-count">{shown.length} players · {edges.length} holder{edges.length === 1 ? '' : 's'} of records</span>
  </div>

  <div class="pm-scroll">
    <svg viewBox="0 0 {W} {H}" role="img"
      aria-label="A simple map of who is involved in this scenario: the requester, the trust layer in the middle, the ledger, the organisations that hold the records, and where the answer goes.">

      <!-- ============ CONNECTIONS (always drawn, faint) ============ -->
      <path d={askPath} class="link" class:live={liveAsk} />
      <path d={logPath} class="link" class:live={liveLog} />
      <path d={ansPath} class="link ans" class:live={liveAns} />
      {#each edges as e, i (e.id)}
        <path d={legPath(i)} class="link" class:live={liveDown || liveUp} />
      {/each}

      <!-- ============ MOVING DOTS — only for the hop that is happening ============ -->
      {#key `${scenario.id}-${active}`}
        {#if liveAsk}
          <circle r="7" class="dot ask"><animateMotion dur="1.1s" repeatCount="indefinite" path={askPath} /></circle>
        {:else if liveLog}
          <circle r="6" class="dot log"><animateMotion dur="0.9s" repeatCount="indefinite" path={logPath} /></circle>
        {:else if liveDown}
          {#each edges as e, i (e.id)}
            <circle r="6" class="dot ask"><animateMotion dur="1.2s" begin="{(i * 0.12).toFixed(2)}s" repeatCount="indefinite" path={legPath(i)} /></circle>
          {/each}
        {:else if liveUp}
          {#each edges as e, i (e.id)}
            <circle r="6" class="dot back" class:pii><animateMotion dur="1.2s" begin="{(i * 0.12).toFixed(2)}s" repeatCount="indefinite" path={legPath(i)} keyPoints="1;0" keyTimes="0;1" calcMode="linear" /></circle>
          {/each}
        {:else if liveAns}
          <circle r="7" class="dot back" class:pii><animateMotion dur="1.1s" repeatCount="indefinite" path={ansPath} /></circle>
        {/if}
      {/key}

      <!-- ============ THE SPINE ============ -->
      <g class="node spine" class:lit={liveConsent}>
        <rect x={SPINE.x} y={SPINE.y} width={SPINE.w} height={SPINE.h} rx="10" class="box" />
        <text x={spineCx} y={SPINE.y + 26} text-anchor="middle" class="n-lab sp">THE SMALL SERVICE IN THE MIDDLE</text>
        <text x={spineCx} y={SPINE.y + 50} text-anchor="middle" class="n-title sp">The trust layer</text>
        <text x={spineCx} y={SPINE.y + 68} text-anchor="middle" class="n-sub sp">directory · consent · rules · identity</text>
        <g transform="translate({spineCx - 62}, {SPINE.y + 76})">
          <rect x="0" y="0" width="124" height="17" rx="8.5" class="zero" />
          <text x="62" y="12" text-anchor="middle" class="zero-t">HOLDS 0 RECORDS</text>
        </g>
      </g>

      <!-- ============ REQUESTER ============ -->
      {#if requester}
        <g class="node" class:lit={liveAsk}>
          <rect x={REQ.x} y={REQ.y} width={REQ.w} height={REQ.h} rx="9" class="box req" />
          <text x={REQ.x + 12} y={REQ.y + 20} class="n-lab">WHO IS ASKING</text>
          <text x={REQ.x + 12} y={REQ.y + 42} class="n-title">{requester.label}</text>
          <text x={REQ.x + 12} y={REQ.y + 60} class="n-sub">{requester.sub}</text>
        </g>
      {/if}

      <!-- ============ ANSWER ============ -->
      {#if answer}
        <g class="node" class:lit={liveAns}>
          <rect x={ANS.x} y={ANS.y} width={ANS.w} height={ANS.h} rx="9" class="box ans" class:hot={answer.hot} />
          <text x={ANS.x + 12} y={ANS.y + 20} class="n-lab" class:hot={answer.hot}>WHAT COMES BACK</text>
          <text x={ANS.x + 12} y={ANS.y + 42} class="n-title">{answer.label}</text>
          <text x={ANS.x + 12} y={ANS.y + 60} class="n-sub">{answer.sub}</text>
        </g>
      {/if}

      <!-- ============ LEDGER ============ -->
      <g class="node" class:lit={liveLog}>
        <rect x={LEDGER.x} y={LEDGER.y} width={LEDGER.w} height={LEDGER.h} rx="8" class="box ledger" />
        <text x={LEDGER.x + LEDGER.w / 2} y={LEDGER.y + 20} text-anchor="middle" class="n-title sm">The ledger</text>
        <text x={LEDGER.x + LEDGER.w / 2} y={LEDGER.y + 35} text-anchor="middle" class="n-sub">every ask, written down first</text>
      </g>

      <!-- ============ THE HOLDERS ============ -->
      <text x="24" y={EDGE_Y - 12} class="row-lab">WHO ACTUALLY HOLDS THE RECORDS — AND KEEPS THEM</text>
      {#each edges as e, i (e.id)}
        {@const b = edgeBox(i)}
        <g class="node" class:lit={liveDown || liveUp}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="9" class="box edge" />
          <text x={b.x + b.w / 2} y={b.y + 24} text-anchor="middle" class="n-title sm">{e.label}</text>
          <text x={b.x + b.w / 2} y={b.y + 41} text-anchor="middle" class="n-sub">{e.sub}</text>
          <g class="lock" transform="translate({b.x + b.w / 2 - 8}, {b.y + 48})">
            <rect x="0" y="7" width="16" height="11" rx="2.5" class="lock-b" />
            <path class="lock-s" d="M 3 7 V 4.5 A 4.5 4.5 0 0 1 12 4.5 V 7" />
          </g>
        </g>
      {/each}
    </svg>
  </div>

  <p class="pm-cap">
    <b>Stage {STAGES[active].no} of 6.</b> {CAPTION[activeStage]}
  </p>
</div>

<style>
  .pm { border-bottom: 1.5px solid rgba(26,16,8,0.4); background: #ffffff; }
  .pm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 18px 0; }
  .pm-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(26,16,8,0.58); }
  .pm-lab b { color: var(--accent-ink, #0e5b66); }
  .pm-count { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.06em; color: var(--accent-ink, #0e5b66); }

  .pm-scroll { overflow-x: auto; padding: 6px 18px 0; }
  svg { display: block; min-width: 760px; width: 100%; height: auto; }

  .link { fill: none; stroke: rgba(26,16,8,0.22); stroke-width: 1.8; transition: stroke 0.3s, stroke-width 0.3s; }
  .link.live { stroke: var(--accent-ink, #0e5b66); stroke-width: 2.6; }
  .link.ans.live { stroke: #2f7d4f; }

  .dot { stroke: #ffffff; stroke-width: 1.6; }
  .dot.ask { fill: var(--accent-ink, #0e5b66); }
  .dot.log { fill: rgba(26,16,8,0.6); }
  .dot.back { fill: #2f7d4f; }
  .dot.back.pii { fill: #8a2d3a; }

  .box { fill: #ffffff; stroke: rgba(26,16,8,0.42); stroke-width: 1.6; transition: stroke 0.3s, stroke-width 0.3s; }
  .node.lit .box { stroke: var(--accent-ink, #0e5b66); stroke-width: 2.6; }
  .box.req { border-radius: 9px; }
  .box.ans { fill: #eef6f0; stroke: rgba(47,125,79,0.6); }
  .box.ans.hot { fill: #f7e6e6; stroke: rgba(138,45,58,0.6); }
  .box.ledger { fill: #f3efe4; }
  .box.edge { fill: #faf6ec; }
  .spine .box { fill: var(--accent-ink, #0e5b66); stroke: #05343b; stroke-width: 2; }
  .node.spine.lit .box { stroke: #d9a05e; stroke-width: 3; }

  .n-lab { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; letter-spacing: 0.14em; fill: rgba(26,16,8,0.55); }
  .n-lab.hot { fill: #8a2d3a; }
  .n-lab.sp { fill: #8fc3bd; }
  .n-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; fill: var(--ink); }
  .n-title.sm { font-size: 14px; }
  .n-title.sp { fill: #ffffff; font-size: 20px; }
  .n-sub { font-family: 'DM Sans', sans-serif; font-size: 10.5px; fill: rgba(26,16,8,0.65); }
  .n-sub.sp, .spine .n-sub { fill: #cfe6e4; }
  .zero { fill: #eef6f0; stroke: #2f7d4f; stroke-width: 1.2; }
  .zero-t { font-family: 'JetBrains Mono', monospace; font-size: 7.5px; font-weight: 600; letter-spacing: 0.1em; fill: #216b3f; }
  .row-lab { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.12em; fill: rgba(26,16,8,0.55); }
  .lock-b { fill: rgba(26,16,8,0.6); }
  .lock-s { fill: none; stroke: rgba(26,16,8,0.6); stroke-width: 1.7; }

  .pm-cap { font-size: 13.5px; line-height: 1.5; color: rgba(26,16,8,0.8); margin: 0; padding: 8px 18px 14px; }
  .pm-cap b { color: var(--accent-ink, #0e5b66); }

  @media (max-width: 700px) {
    .pm-head, .pm-cap { padding-left: 12px; padding-right: 12px; }
    .pm-scroll { padding-left: 12px; padding-right: 12px; }
  }
</style>
