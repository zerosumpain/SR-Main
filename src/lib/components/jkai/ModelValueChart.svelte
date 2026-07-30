<script lang="ts">
  // Quality-vs-cost comparison for the model picker's "compare" tab.
  //
  // Two exhibits, each doing one job:
  //   1. Scatter — quality (Artificial Analysis agentic index) against blended
  //      $/1M on a log price axis, plus the value frontier: the models no other
  //      model beats on BOTH axes. Answers "what am I giving up to go cheaper".
  //      The price axis runs DESCENDING left→right (dear on the left, cheap on
  //      the right) so "better" is consistently up-and-to-the-right and the
  //      frontier reads as the top-right envelope. Tick labels therefore count
  //      down; the axis is labelled "cheaper →" at the right edge to say so.
  //   2. Ranked bars — the top models by the hybrid score the site actually
  //      selects on (quality/price/speed, weights from the API). Answers "what
  //      would the nightly routing pick".
  //
  // Bespoke SVG with the house chartkit helpers, same as the policy-engine
  // exhibits — no chart library anywhere in this codebase.
  import { linScale, niceTicks } from '$lib/presentation/chartkit';

  interface ChartRow {
    id: string;
    name: string;
    blendedPerM: number | null;
    qualityIndex: number | null;
    throughput: string | null;
    openWeights: boolean;
    score: number | null;
  }

  let {
    rows,
    activeModelId = null,
    loading = false,
    expanded = false,
    qualityLabel = 'quality',
    onpick,
    onexpandchange,
  }: {
    rows: ChartRow[];
    activeModelId?: string | null;
    loading?: boolean;
    /** Owned by the picker so its Escape handler can collapse before closing. */
    expanded?: boolean;
    /** Names the metric currently on the y axis (the picker lets it change). */
    qualityLabel?: string;
    onpick: (id: string) => void;
    onexpandchange?: (v: boolean) => void;
  } = $props();

  // Same local body-portal as OpenRouterModelPicker — NOT $lib/canvas/portal,
  // which re-appends the node on destroy and would strand the overlay open.
  function bodyPortal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  // Only rows with both axes plot. A log price axis cannot represent $0, so
  // free models are excluded rather than clamped onto a misleading position —
  // the count is surfaced under the chart instead.
  const plottable = $derived(
    rows.filter(
      (r) => r.qualityIndex != null && r.blendedPerM != null && r.blendedPerM > 0,
    ) as Array<ChartRow & { qualityIndex: number; blendedPerM: number }>,
  );
  const omitted = $derived(rows.length - plottable.length);

  /** Pareto-optimal set: nothing cheaper is also better. Walk price ascending
   *  and keep each model that raises the running best quality. */
  const frontier = $derived.by(() => {
    const byPrice = [...plottable].sort((a, b) => a.blendedPerM - b.blendedPerM);
    const out: typeof byPrice = [];
    let best = -Infinity;
    for (const m of byPrice) {
      if (m.qualityIndex > best) {
        best = m.qualityIndex;
        out.push(m);
      }
    }
    return out;
  });
  const frontierIds = $derived(new Set(frontier.map((m) => m.id)));

  const ranked = $derived(
    [...rows]
      .filter((r) => r.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 10),
  );

  // ── geometry ──────────────────────────────────────────────────────────────
  const padL = 42,
    padR = 14,
    padT = 12,
    padB = 26;
  let host = $state<HTMLDivElement | null>(null);
  let w = $state(560);
  // Expanded gets the extra vertical room; on a narrow screen a 520px plot would
  // push the ranked bars entirely off-screen, so scale it back.
  const height = $derived(expanded ? (w < 560 ? 380 : 520) : 250);
  // Plain let — a debounce handle read+written by the observer must never be
  // $state (see svelte5-pitfalls §1).
  $effect(() => {
    if (!host) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        w = Math.max(260, cw);
      }, 80);
    });
    ro.observe(host);
    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
    };
  });

  const innerW = $derived(w - padL - padR);
  const innerH = $derived(height - padT - padB);

  const priceDomain = $derived.by(() => {
    if (!plottable.length) return [-2, 2] as [number, number];
    const logs = plottable.map((m) => Math.log10(m.blendedPerM));
    return [Math.min(...logs) - 0.15, Math.max(...logs) + 0.15] as [number, number];
  });
  const qualityDomain = $derived.by(() => {
    if (!plottable.length) return [0, 100] as [number, number];
    const qs = plottable.map((m) => m.qualityIndex);
    const lo = Math.min(...qs);
    const hi = Math.max(...qs);
    const pad = Math.max(1, (hi - lo) * 0.08);
    return [lo - pad, hi + pad] as [number, number];
  });

  // Range reversed: the domain's LOW end (cheapest) maps to the RIGHT edge, so
  // both axes improve towards the top-right corner.
  const xs = $derived(linScale(priceDomain, [padL + innerW, padL]));
  const ys = $derived(linScale(qualityDomain, [padT + innerH, padT]));

  /** Whole-decade price ticks ($0.01, $0.10, $1, $10, …) — the readable grid on
   *  a log axis; niceTicks would put them at arbitrary log fractions. */
  const priceTicks = $derived.by(() => {
    const [lo, hi] = priceDomain;
    const out: number[] = [];
    for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) out.push(d);
    return out.length >= 2 ? out : [lo, hi];
  });
  const qualityTicks = $derived(niceTicks(qualityDomain[0], qualityDomain[1], 4));

  /** Stepped path along the frontier — a straight line between two Pareto
   *  points would claim models exist in between. */
  const frontierPath = $derived.by(() => {
    if (frontier.length < 2) return '';
    let d = '';
    for (let i = 0; i < frontier.length; i++) {
      const m = frontier[i];
      const x = xs(Math.log10(m.blendedPerM));
      const y = ys(m.qualityIndex);
      if (i === 0) d += `M ${x} ${y}`;
      else d += ` H ${x} V ${y}`;
    }
    return d;
  });

  // ── hover ────────────────────────────────────────────────────────────────
  let hovered = $state<string | null>(null);
  let hoverAt = $state<{ x: number; y: number } | null>(null);

  const hoveredRow = $derived(plottable.find((m) => m.id === hovered) ?? null);

  function enter(m: ChartRow & { qualityIndex: number; blendedPerM: number }) {
    hovered = m.id;
    hoverAt = { x: xs(Math.log10(m.blendedPerM)), y: ys(m.qualityIndex) };
  }
  function leave() {
    hovered = null;
    hoverAt = null;
  }

  // ── formatting ───────────────────────────────────────────────────────────
  function money(perM: number): string {
    if (perM >= 100) return `$${perM.toFixed(0)}`;
    if (perM >= 1) return `$${perM.toFixed(2)}`;
    return `$${perM.toFixed(3)}`;
  }
  function decadeLabel(exp: number): string {
    const v = Math.pow(10, exp);
    return v >= 1 ? `$${v.toFixed(0)}` : `$${v.toFixed(Math.min(3, -exp))}`;
  }
  function shortName(id: string): string {
    return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  }
  function tps(v: string | null): string {
    if (!v) return '—';
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(0)} t/s` : '—';
  }

  /** Built as one string so the separators don't depend on template whitespace. */
  function statLine(m: ChartRow & { qualityIndex: number; blendedPerM: number }): string {
    const bits = [`q ${m.qualityIndex.toFixed(0)}`, `${money(m.blendedPerM)}/1M`, tps(m.throughput)];
    if (m.score != null) bits.push(`score ${m.score.toFixed(2)}`);
    return bits.join(' · ');
  }

  const note = $derived.by(() => {
    const bits = [`${plottable.length} models plotted`];
    if (omitted > 0) bits.push(`${omitted} hidden (free or unrated — no log-scale position)`);
    if (loading) bits.push('loading…');
    return bits.join(' · ');
  });

  /** Frontier labels only, and only where they don't collide — a label on every
   *  point is unreadable at 340 models, and the top of the frontier bunches up.
   *  Walk from the best quality down, keeping a label only when its box clears
   *  the ones already placed.
   *
   *  The box has to be computed for real, not approximated by anchor distance:
   *  a label near the right edge is end-anchored and extends LEFT, so two
   *  anchors 117px apart still overlapped (nex-n2-pro / hy3-preview). Width is
   *  estimated at ~5.4px/char, which is right for 9px JetBrains Mono. The
   *  template renders from these same numbers so the two can't drift. */
  const CHAR_W = 5.4;
  const labelled = $derived.by(() => {
    const kept: Array<{
      id: string;
      label: string;
      y: number;
      anchorX: number;
      anchorEnd: boolean;
      left: number;
      right: number;
    }> = [];
    const candidates = [...frontier].sort((a, b) => b.qualityIndex - a.qualityIndex);
    for (const m of candidates) {
      if (kept.length >= 5) break;
      const label = shortName(m.id);
      const w = label.length * CHAR_W;
      const x = xs(Math.log10(m.blendedPerM));
      const y = ys(m.qualityIndex);
      const anchorEnd = x > padL + innerW * 0.72;
      const left = anchorEnd ? x - 8 - w : x + 8;
      const right = left + w;
      const clashes = kept.some(
        (k) => Math.abs(k.y - y) < 13 && left < k.right + 6 && k.left < right + 6,
      );
      if (clashes) continue;
      kept.push({ id: m.id, label, y, anchorX: anchorEnd ? x - 8 : x + 8, anchorEnd, left, right });
    }
    return kept;
  });
</script>

{#snippet chart()}
  <div class="chart-head">
    <span class="chart-title">{qualityLabel} vs cost</span>
    <span class="chart-legend">
      <span class="key"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="dot-open" /></svg>open weights</span>
      <span class="key"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" class="dot-closed" /></svg>closed</span>
      <span class="key"><svg width="14" height="10" aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5" class="key-frontier" /></svg>value frontier</span>
      <button
        type="button"
        class="expand-btn"
        aria-pressed={expanded}
        title={expanded ? 'Exit full screen (Esc)' : 'Expand to full screen'}
        onclick={() => onexpandchange?.(!expanded)}
        >{expanded ? '✕ close' : '⤢ expand'}</button
      >
    </span>
  </div>

  <div class="plot">
    <svg
      viewBox="0 0 {w} {height}"
      width="100%"
      {height}
      role="img"
      aria-label="Scatter plot of model {qualityLabel} against blended cost per million tokens. The full data is in the list tab."
    >
      {#each qualityTicks as t (t)}
        <line x1={padL} x2={padL + innerW} y1={ys(t)} y2={ys(t)} class="grid" />
        <text x={padL - 6} y={ys(t) + 3} class="axis-lab" text-anchor="end">{t.toFixed(0)}</text>
      {/each}
      {#each priceTicks as t (t)}
        <line x1={xs(t)} x2={xs(t)} y1={padT} y2={padT + innerH} class="grid grid-v" />
        <text x={xs(t)} y={height - 14} class="axis-lab" text-anchor="middle">{decadeLabel(t)}</text>
      {/each}
      <text x={padL} y={height - 2} class="axis-title" text-anchor="start">blended $/1M</text>
      <text x={padL + innerW} y={height - 2} class="axis-title" text-anchor="end">cheaper →</text>
      <!-- Rotated so it can't overrun the left edge the way an end-anchored
           label at x = padL − 6 does. -->
      <text
        class="axis-title"
        text-anchor="middle"
        transform="rotate(-90 11 {padT + innerH / 2})"
        x="11"
        y={padT + innerH / 2}>{qualityLabel} →</text
      >

      {#if frontierPath}
        <path d={frontierPath} class="frontier" fill="none" />
      {/if}

      {#each plottable as m (m.id)}
        {@const cx = xs(Math.log10(m.blendedPerM))}
        {@const cy = ys(m.qualityIndex)}
        {@const isActive = m.id === activeModelId}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <circle
          {cx}
          {cy}
          r={isActive ? 6.5 : hovered === m.id ? 6 : 4.5}
          class="dot"
          class:dot-open={m.openWeights}
          class:dot-closed={!m.openWeights}
          class:is-active={isActive}
          class:on-frontier={frontierIds.has(m.id)}
          onmouseenter={() => enter(m)}
          onmouseleave={leave}
          onclick={() => onpick(m.id)}
        >
          <title>{m.id} — quality {m.qualityIndex.toFixed(0)}, {money(m.blendedPerM)}/1M</title>
        </circle>
      {/each}

      {#each labelled as m (m.id)}
        <text
          x={m.anchorX}
          y={m.y - 7}
          class="point-lab"
          text-anchor={m.anchorEnd ? 'end' : 'start'}>{m.label}</text
        >
      {/each}
    </svg>

    {#if hoveredRow && hoverAt}
      <div
        class="tip"
        class:flip={hoverAt.x > w * 0.6}
        style="left:{(hoverAt.x / w) * 100}%; top:{hoverAt.y}px"
      >
        <span class="tip-name"
          >{shortName(hoveredRow.id)}{#if hoveredRow.openWeights}<span class="tip-open">open</span>{/if}</span
        >
        <span class="tip-id">{hoveredRow.id}</span>
        <span class="tip-stats">{statLine(hoveredRow)}</span>
      </div>
    {/if}
  </div>

  <p class="chart-note">{note}</p>

  <div class="chart-head chart-head--second">
    <span class="chart-title">Best value by hybrid score</span>
  </div>

  {#if ranked.length > 0}
    <ol class="bars">
      {#each ranked as m, i (m.id)}
        <li>
          <button
            type="button"
            class="bar-row"
            class:is-active={m.id === activeModelId}
            title={m.id}
            onclick={() => onpick(m.id)}
          >
            <span class="bar-rank">{i + 1}</span>
            <span class="bar-name"
              >{shortName(m.id)}{#if m.openWeights}<span class="bar-open">open</span>{/if}</span
            >
            <span class="bar-track">
              <span
                class="bar-fill"
                class:fill-open={m.openWeights}
                style="width:{Math.max(2, (m.score ?? 0) * 100)}%"
              ></span>
            </span>
            <span class="bar-val">{(m.score ?? 0).toFixed(2)}</span>
          </button>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="chart-note">No scored models in this filter — a score needs both a quality index and a price.</p>
  {/if}
{/snippet}

<!-- Expanded renders into a body-portaled overlay rather than growing in place:
     the picker modal is overflow:hidden and its entry animation makes it a
     containing block, so a position:fixed child would be clipped inside it. Only
     one branch is mounted at a time, so bind:this / the ResizeObserver follow. -->
{#if expanded}
  <div class="chart-overlay" use:bodyPortal>
    <div class="chart-host is-expanded" bind:this={host}>
      {@render chart()}
    </div>
  </div>
{:else}
  <div class="chart-host" bind:this={host}>
    {@render chart()}
  </div>
{/if}

<style>
  .chart-host {
    padding: 0 16px 4px;
    min-width: 0;
  }
  /* Above the picker modal's 9001. Opaque surface — a tint token would let the
     chat show through (see the modal note in sr-design). */
  .chart-overlay {
    position: fixed;
    inset: 0;
    z-index: 9100;
    background: var(--bg);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .chart-host.is-expanded {
    max-width: 1180px;
    margin: 0 auto;
    padding: 20px 24px calc(24px + env(safe-area-inset-bottom));
  }
  .expand-btn {
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--card-border);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
  }
  .expand-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-ghost);
  }
  .chart-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .chart-head--second {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--divider);
  }
  .chart-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .chart-legend {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .key svg {
    overflow: visible;
  }
  .key-frontier {
    stroke: var(--text-ghost);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }

  .plot {
    position: relative;
  }
  svg {
    display: block;
  }
  .grid {
    stroke: var(--divider);
    stroke-width: 1;
  }
  .grid-v {
    stroke-dasharray: 2 3;
  }
  .axis-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
  }
  .axis-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
    letter-spacing: 0.06em;
  }
  .frontier {
    stroke: var(--text-ghost);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
    opacity: 0.75;
  }

  /* Fill vs hollow carries identity alongside hue, so the two series stay
     distinguishable without relying on colour alone. */
  .dot {
    cursor: pointer;
    transition: r 90ms ease;
  }
  .dot-open {
    fill: var(--accent);
    stroke: var(--surface-elevated);
    stroke-width: 1;
  }
  .dot-closed {
    fill: var(--surface-elevated);
    stroke: var(--accent-ink);
    stroke-width: 1.6;
  }
  .dot.on-frontier {
    stroke-width: 2;
  }
  .dot.is-active {
    stroke: var(--text-primary);
    stroke-width: 2.5;
  }
  .point-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-secondary);
    pointer-events: none;
  }

  .tip {
    position: absolute;
    transform: translate(8px, -50%);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    max-width: 230px;
    /* Opaque — --card-bg is a 7% tint and would read as transparent here. */
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    pointer-events: none;
    z-index: 2;
  }
  .tip.flip {
    transform: translate(calc(-100% - 8px), -50%);
  }
  .tip-name {
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tip-open,
  .bar-open {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    vertical-align: 1px;
  }
  .tip-id,
  .tip-stats {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chart-note {
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .bars {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) 34% 34px;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-round);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .bar-row:hover {
    background: var(--surface-overlay);
  }
  .bar-row.is-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .bar-rank,
  .bar-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .bar-val {
    text-align: right;
  }
  .bar-name {
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar-track {
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--divider);
    overflow: hidden;
  }
  .bar-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--accent-ink);
  }
  .bar-fill.fill-open {
    background: var(--accent);
  }

  @media (max-width: 640px) {
    .chart-host {
      padding: 0 12px 4px;
    }
    .bar-row {
      grid-template-columns: 16px minmax(0, 1fr) 28% 30px;
      gap: 6px;
    }
    .point-lab {
      display: none;
    }
    .chart-legend {
      gap: 8px;
    }
    .key {
      font-size: var(--fs-label-xs);
    }
  }
</style>
