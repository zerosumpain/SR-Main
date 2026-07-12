<script lang="ts">
  // WorldTour — Beat 6 "borrowed from the world". Two linked panels sharing one
  // highlight state:
  //   (A) a DATA↔TRUST spectrum plotting the 7 SURVEY_ARCHETYPES (positioned by how
  //       little data each model moves) + England as a distinct star, with the 5
  //       OBSERVATIONS as callouts near the axis;
  //   (B) a "bill of materials" of the 10 REQUIREMENTS, each cross-highlighting on
  //       the spectrum the archetype(s) it is lifted from (REQUIREMENT_LINK), and
  //       vice-versa. Same Svelte-5 / opaque-surface conventions as FlowsDiagram.
  import {
    SURVEY_ARCHETYPES,
    REQUIREMENTS,
    OBSERVATIONS,
    ARCHETYPE_AXIS,
    ENGLAND_MODEL,
    REQUIREMENT_LINK,
  } from '../lib/model';

  let { eli = false }: { eli?: boolean } = $props();

  // ── shared highlight state ────────────────────────────────────────────────
  // activeArch: a SurveyArchetype.no (0 = England); activeReq: a Requirement.need.
  // Selecting one kind clears the other; cross-highlight is derived from the link.
  let activeArch = $state<number | null>(null);
  let activeReq = $state<string | null>(null);

  function pickArch(no: number) {
    activeArch = activeArch === no ? null : no;
    activeReq = null;
  }
  function pickReq(need: string) {
    activeReq = activeReq === need ? null : need;
    activeArch = null;
  }
  function clearAll() {
    activeArch = null;
    activeReq = null;
  }
  function keyAct(e: KeyboardEvent, fn: () => void) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  }

  const linkFor = (need: string): number[] => REQUIREMENT_LINK[need]?.archetypeNos ?? [];

  // an archetype marker is "hot" when directly selected OR borrowed-from by the
  // active requirement
  function archHot(no: number): boolean {
    if (activeArch === no) return true;
    if (activeReq) return linkFor(activeReq).includes(no);
    return false;
  }
  // dim non-hot markers whenever there is any active selection (England stays lit)
  function archDim(no: number): boolean {
    if (no === 0) return false; // England is the anchor — never dimmed
    return (activeArch !== null || activeReq !== null) && !archHot(no);
  }

  function reqHot(need: string): boolean {
    if (activeReq === need) return true;
    if (activeArch !== null && activeArch !== 0) return linkFor(need).includes(activeArch);
    return false;
  }
  function reqDim(need: string): boolean {
    return (activeArch !== null || activeReq !== null) && !reqHot(need);
  }

  const selectedArchetype = $derived(
    activeArch !== null && activeArch !== 0
      ? SURVEY_ARCHETYPES.find((a) => a.no === activeArch)
      : undefined,
  );
  const englandSelected = $derived(activeArch === 0);

  // ── spectrum geometry ─────────────────────────────────────────────────────
  // dataMoves 0 → far RIGHT (centralises only trust); higher → LEFT (more data
  // moves). Domain capped at 0.5 so the real deployments (all ≤0.34) spread out
  // and the empty left third reads as the "central pool nobody builds".
  const W = 760;
  const H = 214;
  const padL = 72;
  const padR = 60;
  const SPAN = W - padL - padR;
  const DOMAIN = 0.5;
  const axisY = 182;
  const X = (dm: number) => padL + (1 - Math.min(Math.max(dm, 0), DOMAIN) / DOMAIN) * SPAN;

  type Marker = {
    kind: 'arch' | 'england';
    no: number;
    x: number;
    y: number;
    centralises: string;
    label: string;
  };

  // greedy 3-lane layout so crowded right-hand markers don't collide
  const LAYOUT: Marker[] = (() => {
    const raw: Omit<Marker, 'y'>[] = [
      ...SURVEY_ARCHETYPES.map((a) => ({
        kind: 'arch' as const,
        no: a.no,
        x: X(ARCHETYPE_AXIS[a.no].dataMoves),
        centralises: ARCHETYPE_AXIS[a.no].centralises,
        label: a.short,
      })),
      {
        kind: 'england' as const,
        no: 0,
        x: X(ENGLAND_MODEL.dataMoves),
        centralises: ENGLAND_MODEL.centralises,
        label: 'England',
      },
    ].sort((p, q) => p.x - q.x);

    const laneY = [44, 92, 140];
    const lastX = [-999, -999, -999];
    const MIN = 58;
    return raw.map((m) => {
      let lane = laneY.findIndex((_, i) => m.x - lastX[i] >= MIN);
      if (lane === -1) lane = lastX.indexOf(Math.min(...lastX));
      lastX[lane] = m.x;
      return { ...m, y: laneY[lane] };
    });
  })();

  function starPoints(cx: number, cy: number, r: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.44;
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(`${(cx + rad * Math.cos(ang)).toFixed(1)},${(cy + rad * Math.sin(ang)).toFixed(1)}`);
    }
    return pts.join(' ');
  }
</script>

<div class="tour">
  <header class="t-head">
    <span class="eyebrow">Beat 6 · Borrowed from the world</span>
    <h3>Nothing here is invented</h3>
    <p class="lede">
      Every requirement is lifted from a proven national deployment — and England's proposed model
      centralises <em>trust and routing</em>, moving less pupil data than any national exchange on the line.
    </p>
    {#if activeArch !== null || activeReq !== null}
      <button class="clear" onclick={clearAll} title="Clear the current selection">Clear ✕</button>
    {/if}
  </header>

  {#if eli}
    <p class="eli-note">
      Lots of countries already share data safely. This picture puts them on a line: the further right,
      the <b>less</b> real data they move around. England's star sits near the far-right end — it moves
      barely any, and only keeps the &ldquo;who's allowed to ask&rdquo; part in the middle.
    </p>
  {/if}

  <!-- ── PANEL A: the DATA↔TRUST spectrum ─────────────────────────────────── -->
  <section class="panel spectrum">
    <div class="p-tag">Panel A · the DATA ↔ TRUST spectrum</div>
    <div class="scroll">
      <svg viewBox="0 0 {W} {H}" role="img"
           aria-label="Spectrum from 'moves the data' on the left to 'centralises only trust' on the right, plotting seven world archetypes and England's proposed model.">
        <defs>
          <linearGradient id="wt-axis" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#7a5aa6" />
            <stop offset="0.5" stop-color="#a8842a" />
            <stop offset="1" stop-color="#0e5b66" />
          </linearGradient>
        </defs>

        <!-- axis bar + end labels -->
        <rect class="axis-bar" x={padL} y={axisY - 5} width={SPAN} height="10" rx="5" fill="url(#wt-axis)" />
        <text class="axis-end" x={padL} y={axisY + 26} text-anchor="start">◀ MOVES THE DATA</text>
        <text class="axis-sub" x={padL} y={axisY + 39} text-anchor="start">bulk copies to a central pool</text>
        <text class="axis-end" x={W - padR} y={axisY + 26} text-anchor="end">CENTRALISES ONLY TRUST ▶</text>
        <text class="axis-sub" x={W - padR} y={axisY + 39} text-anchor="end">data stays with the owner</text>

        <!-- ghost "central pool" counterfactual at the empty far-left -->
        <g class="ghost" aria-hidden="true">
          <circle cx={padL} cy={axisY} r="7" />
          <text x={padL} y={axisY - 14} text-anchor="middle">central pool</text>
          <text class="ghost-sub" x={padL} y={axisY - 3} text-anchor="middle">nobody builds this</text>
        </g>

        {#each LAYOUT as m (m.no)}
          {@const hot = archHot(m.no)}
          {@const dim = archDim(m.no)}
          <g class="marker" class:hot class:dim class:england={m.kind === 'england'}
             role="button" tabindex="0"
             aria-label={m.kind === 'england'
               ? `England (proposed) — centralises ${m.centralises}. Select to highlight the requirements borrowed from the world.`
               : `Archetype ${m.no}: ${m.label} — centralises ${m.centralises}. Select to highlight where it is borrowed.`}
             onclick={() => pickArch(m.no)}
             onkeydown={(e) => keyAct(e, () => pickArch(m.no))}>
            <!-- drop-line to the axis, making each x-position legible -->
            <line class="drop" x1={m.x} y1={m.y + (m.kind === 'england' ? 16 : 15)} x2={m.x} y2={axisY - 5} />
            {#if m.kind === 'england'}
              <polygon class="star" points={starPoints(m.x, m.y, 16)} />
              <text class="m-num star-num" x={m.x} y={m.y + 4} text-anchor="middle">E</text>
            {:else}
              <circle class="m-dot" cx={m.x} cy={m.y} r="15" />
              <text class="m-num" x={m.x} y={m.y + 4} text-anchor="middle">{m.no}</text>
            {/if}
            <text class="m-cap" class:show={hot} x={m.x} y={m.y - 21} text-anchor="middle">{m.centralises}</text>
          </g>
        {/each}
      </svg>
    </div>

    <!-- numbered key — doubles as an accessible list of controls -->
    <div class="key">
      {#each SURVEY_ARCHETYPES as a (a.no)}
        <button class="key-item" class:hot={archHot(a.no)} class:dim={archDim(a.no)}
                onclick={() => pickArch(a.no)}
                title="{a.name} — centralises {ARCHETYPE_AXIS[a.no].centralises}"
                aria-label="Archetype {a.no}: {a.name}. Select on the spectrum.">
          <span class="k-no">{a.no}</span>
          <span class="k-txt"><b>{a.short}</b><i>centralises {ARCHETYPE_AXIS[a.no].centralises}</i></span>
        </button>
      {/each}
      <button class="key-item england-key" class:hot={englandSelected}
              onclick={() => pickArch(0)}
              title="England (proposed) — centralises {ENGLAND_MODEL.centralises}"
              aria-label="England proposed model. Select on the spectrum.">
        <span class="k-no star-badge">★</span>
        <span class="k-txt"><b>{ENGLAND_MODEL.label}</b><i>centralises {ENGLAND_MODEL.centralises}</i></span>
      </button>
    </div>

    <!-- detail card for the selected marker -->
    {#if selectedArchetype}
      <div class="detail">
        <span class="d-kicker">Archetype {selectedArchetype.no} · {selectedArchetype.short}</span>
        <h4>{selectedArchetype.name}</h4>
        <p class="d-what">{selectedArchetype.what}</p>
        <ul class="impls">
          {#each selectedArchetype.impls as im (im.where + im.system)}
            <li>
              <div class="im-top"><b>{im.where}</b><span class="im-sys">{im.system}</span></div>
              <div class="im-tech">{im.tech}</div>
              <div class="im-note">{im.note}</div>
            </li>
          {/each}
        </ul>
      </div>
    {:else if englandSelected}
      <div class="detail england-detail">
        <span class="d-kicker">England · proposed model</span>
        <h4>{ENGLAND_MODEL.label}</h4>
        <p class="d-what">
          England's is the one model that centralises only <b>{ENGLAND_MODEL.centralises}</b>, moving less
          pupil data than any national exchange on the line — bettered only by pure compute-to-data, which it
          borrows for exactly that reason. Select a requirement below, or a numbered archetype, to see which
          proven deployment each piece is lifted from.
        </p>
      </div>
    {:else}
      <p class="detail-hint">
        Select a marker to open its national implementations — or a requirement below to see which
        archetype(s) it borrows from.
      </p>
    {/if}

    <!-- OBSERVATIONS as callouts near the axis -->
    <div class="obs">
      {#each OBSERVATIONS as o (o.title)}
        <div class="obs-card">
          <b>{o.title}</b>
          <p>{o.body}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- ── PANEL B: the bill of materials ───────────────────────────────────── -->
  <section class="panel bom">
    <div class="p-tag">Panel B · the bill of materials</div>
    <p class="bom-lede">
      Ten requirements for England's spine — each one <b>lifted</b> from a national deployment already
      running it at scale. Select a row to light up its source archetype(s) on the spectrum.
    </p>
    <ul class="req-list">
      {#each REQUIREMENTS as r (r.need)}
        {@const nos = linkFor(r.need)}
        <li class="req" class:hot={reqHot(r.need)} class:dim={reqDim(r.need)}>
          <button class="req-hit" onclick={() => pickReq(r.need)}
                  aria-label="Requirement: {r.need}. Borrowed from archetypes {nos.join(', ')}. Select to highlight on the spectrum."
                  title="Select to cross-highlight the spectrum">
            <span class="r-need">{r.need}</span>
            <span class="r-how">{r.how}</span>
            <span class="r-from">borrowed from · {r.from}</span>
          </button>
          <div class="r-chips">
            {#each nos as n (n)}
              <button class="chip" class:hot={archHot(n)}
                      onclick={() => pickArch(n)}
                      title="Archetype {n}: {SURVEY_ARCHETYPES.find((a) => a.no === n)?.short}"
                      aria-label="Jump to archetype {n} on the spectrum">{n}</button>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <p class="takeaway">
    <b>The takeaway.</b> None of this is speculative. Every requirement is a working national deployment,
    and England's model centralises the primitive that moves <em>barely any</em> data — trust
    and routing, not the records themselves.
  </p>
</div>

<style>
  .tour { display: flex; flex-direction: column; gap: 18px; }

  .t-head { position: relative; }
  .eyebrow { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .t-head h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(20px, 2.4vw, 28px); color: var(--ink, #1a1008); margin: 6px 0 8px; letter-spacing: -0.01em; }
  .lede { font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.6; color: rgba(26,16,8,0.82); max-width: 760px; margin: 0; }
  .lede em, .takeaway em { font-style: italic; color: var(--accent, #c4570a); font-weight: 600; }
  .clear { position: absolute; top: 0; right: 0; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink); background: #ffffff; border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-pill, 100px); padding: 6px 12px; cursor: pointer; }
  .clear:hover { border-color: var(--ink); }

  .eli-note { font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-style: italic; line-height: 1.6; color: rgba(26,16,8,0.82); background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid var(--accent, #c4570a); border-radius: var(--radius-round, 8px); padding: 12px 16px; margin: 0; }
  .eli-note b { color: var(--ink); }

  .panel { background: var(--surface-elevated, #e8dece); border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round, 8px); padding: 16px 18px 18px; }
  .p-tag { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent-ink, #0e5b66); margin-bottom: 12px; }

  /* ── spectrum svg ── */
  .scroll { overflow-x: auto; }
  svg { display: block; min-width: 620px; width: 100%; height: auto; }

  .axis-bar { stroke: rgba(26,16,8,0.4); stroke-width: 1; }
  .axis-end { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; fill: var(--ink, #1a1008); }
  .axis-sub { font-family: 'DM Sans', sans-serif; font-size: 10px; fill: rgba(26,16,8,0.72); }

  .ghost circle { fill: #ede4d4; stroke: rgba(26,16,8,0.4); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .ghost text { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.06em; fill: rgba(26,16,8,0.6); }
  .ghost .ghost-sub { font-style: italic; }

  .marker { cursor: pointer; }
  .marker:focus { outline: none; }
  .marker:focus-visible .m-dot,
  .marker:focus-visible .star { stroke: var(--accent, #c4570a); stroke-width: 3; }
  .drop { stroke: rgba(26,16,8,0.32); stroke-width: 1.25; stroke-dasharray: 2 3; }
  .m-dot { fill: #ffffff; stroke: var(--accent-ink, #0e5b66); stroke-width: 2; transition: fill 0.12s, stroke 0.12s; }
  .m-num { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; fill: var(--accent-ink, #0e5b66); }
  .star { fill: var(--accent, #c4570a); stroke: #ffffff; stroke-width: 1.5; }
  .star-num { fill: #ffffff; }
  .m-cap { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.02em; fill: var(--ink, #1a1008); opacity: 0; pointer-events: none; }
  .m-cap.show { opacity: 1; }

  .marker.hot .m-dot { fill: var(--accent-ink, #0e5b66); stroke: var(--accent, #c4570a); stroke-width: 3; }
  .marker.hot .m-num { fill: #ffffff; }
  .marker.hot .star { stroke: #a8842a; stroke-width: 3; }
  .marker.hot .drop { stroke: var(--accent, #c4570a); stroke-dasharray: none; stroke-width: 1.75; }
  .marker.dim { opacity: 0.3; }

  /* ── numbered key ── */
  .key { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 7px; margin-top: 14px; }
  .key-item { display: flex; align-items: center; gap: 9px; text-align: left; background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-radius: var(--radius-round, 8px); padding: 7px 10px; cursor: pointer; min-width: 0; }
  .key-item:hover { border-color: var(--accent-ink, #0e5b66); }
  .k-no { flex: 0 0 22px; width: 22px; height: 22px; display: grid; place-content: center; background: var(--accent-ink, #0e5b66); color: #fff; border-radius: var(--radius-pill, 100px); font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; }
  .star-badge { background: var(--accent, #c4570a); }
  .k-txt { display: flex; flex-direction: column; min-width: 0; }
  .k-txt b { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 700; color: var(--ink, #1a1008); line-height: 1.2; }
  .k-txt i { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-style: normal; letter-spacing: 0.03em; color: rgba(26,16,8,0.72); margin-top: 2px; }
  .key-item.hot { background: #fff; border-color: var(--accent, #c4570a); border-width: 2px; }
  .key-item.hot .k-no { background: var(--accent, #c4570a); }
  .england-key.hot .k-no { background: var(--accent, #c4570a); }
  .key-item.dim { opacity: 0.42; }

  /* ── detail card ── */
  .detail { background: #ffffff; border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-round, 8px); padding: 14px 16px; margin-top: 14px; }
  .england-detail { border-left-color: var(--accent, #c4570a); }
  .d-kicker { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-ink, #0e5b66); }
  .england-detail .d-kicker { color: var(--accent, #c4570a); }
  .detail h4 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--ink, #1a1008); margin: 4px 0 6px; }
  .d-what { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.55; color: rgba(26,16,8,0.82); margin: 0; }
  .d-what b { color: var(--ink); }
  .impls { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .impls li { background: #faf6ec; border: 1px solid rgba(26,16,8,0.4); border-radius: var(--radius-sharp, 2px); padding: 9px 11px; }
  .im-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .im-top b { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 700; color: var(--ink, #1a1008); }
  .im-sys { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.03em; color: var(--accent-ink, #0e5b66); }
  .im-tech { font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.5; color: rgba(26,16,8,0.72); margin-top: 3px; }
  .im-note { font-family: 'DM Sans', sans-serif; font-size: 12.5px; line-height: 1.5; color: rgba(26,16,8,0.82); margin-top: 4px; }

  .detail-hint { font-family: 'DM Sans', sans-serif; font-size: 13px; font-style: italic; line-height: 1.5; color: rgba(26,16,8,0.72); margin: 14px 0 0; }

  /* ── observations ── */
  .obs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; margin-top: 16px; }
  .obs-card { background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-top: 3px solid #a8842a; border-radius: var(--radius-round, 8px); padding: 11px 13px; }
  .obs-card b { display: block; font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 700; color: var(--ink, #1a1008); line-height: 1.3; margin-bottom: 5px; }
  .obs-card p { font-family: 'DM Sans', sans-serif; font-size: 11.5px; line-height: 1.5; color: rgba(26,16,8,0.82); margin: 0; }

  /* ── bill of materials ── */
  .bom-lede { font-family: 'DM Sans', sans-serif; font-size: 13.5px; line-height: 1.55; color: rgba(26,16,8,0.82); margin: 0 0 12px; }
  .bom-lede b { color: var(--ink); }
  .req-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
  .req { display: flex; align-items: stretch; gap: 8px; background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid rgba(26,16,8,0.4); border-radius: var(--radius-round, 8px); padding: 11px 12px; min-width: 0; transition: opacity 0.12s; }
  .req-hit { flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; text-align: left; background: none; border: none; padding: 0; cursor: pointer; min-width: 0; }
  .r-need { font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 700; color: var(--ink, #1a1008); line-height: 1.25; }
  .r-how { font-family: 'DM Sans', sans-serif; font-size: 12px; line-height: 1.5; color: rgba(26,16,8,0.82); }
  .r-from { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.03em; color: var(--accent-ink, #0e5b66); margin-top: 2px; }
  .r-chips { flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: flex-start; }
  .chip { width: 24px; height: 24px; display: grid; place-content: center; background: #ffffff; border: 1.5px solid var(--accent-ink, #0e5b66); border-radius: var(--radius-pill, 100px); font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; color: var(--accent-ink, #0e5b66); cursor: pointer; }
  .chip:hover { background: #dce9e4; }
  .chip.hot { background: var(--accent, #c4570a); border-color: var(--accent, #c4570a); color: #fff; }
  .req.hot { background: #ffffff; border-color: var(--accent, #c4570a); border-left-color: var(--accent, #c4570a); border-left-width: 4px; }
  .req.dim { opacity: 0.4; }

  .takeaway { font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.6; color: rgba(26,16,8,0.82); background: #faf6ec; border: 1.5px solid rgba(26,16,8,0.4); border-left: 4px solid #2f7d4f; border-radius: var(--radius-round, 8px); padding: 13px 16px; margin: 0; }
  .takeaway b { color: var(--ink); }

  @media (max-width: 720px) {
    .req-list, .obs, .key { grid-template-columns: 1fr; }
  }
</style>
