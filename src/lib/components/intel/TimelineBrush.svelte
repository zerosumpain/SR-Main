<script lang="ts">
  // The timeline, on a real time axis, with a brush that drives everything else.
  //
  // A list grouped by month tells you what happened. It cannot tell you that
  // three things happened in the same fortnight, or which entities were active
  // in that fortnight — and the second question is the one that makes a
  // timeline part of an intelligence tool rather than a diary. So this
  // component owns a single scale, draws every event against it, and reports
  // the brushed window UP as a range plus the event and entity ids inside it.
  //
  // Two design decisions worth keeping:
  //
  //  - The brush is the SOURCE of the range, including the date inputs
  //    underneath it. Making the range a two-way prop would mean syncing a prop
  //    into local state inside an $effect, which is the documented route to a
  //    hydration stall in this codebase. The parent receives; it never pushes.
  //
  //  - The date inputs are not a nicety. A drag-only brush is unusable by
  //    keyboard, and they double as the way to type an exact window.
  //
  // Drag bookkeeping (mode, anchor, pointer id) is plain `let`: nothing
  // reactive reads it, and a handle that a handler both reads and writes is
  // exactly the shape that loops when an effect touches it.

  import { scaleTime } from 'd3-scale';
  import {
    entityIdsInRange,
    eventExtent,
    eventsInRange,
    eventTime,
    isFullRange,
    normaliseRange,
    parseRangeInputs,
    toDateInput,
    DAY_MS,
    FULL_RANGE,
    type TimeRange,
  } from '$lib/jkai/intel/lenses';

  interface BrushEvent {
    id: string;
    date: string;
    dateEnd?: string | null;
    type: string;
    title: string;
    entityId?: string | null;
    entityName?: string | null;
  }

  let {
    events = [],
    height = 176,
    onChange,
  }: {
    events: BrushEvent[];
    height?: number;
    /** Fired whenever the window changes — this is the linkage to the graph. */
    onChange?: (payload: { range: TimeRange; eventIds: string[]; entityIds: string[] }) => void;
  } = $props();

  /** Lanes, in reading order. Anything unrecognised falls into the last one. */
  const LANES = ['deadline', 'milestone', 'decision', 'event'] as const;
  const LANE_COLOUR: Record<string, string> = {
    deadline: 'var(--error)',
    milestone: 'var(--success)',
    decision: 'var(--warn)',
    event: 'var(--accent-ink)',
  };
  const laneOf = (type: string) => {
    const i = LANES.indexOf(type as (typeof LANES)[number]);
    return i === -1 ? LANES.length - 1 : i;
  };
  const colourOf = (type: string) => LANE_COLOUR[type] ?? 'var(--text-ghost)';

  const PAD = { left: 8, right: 8, top: 14, bottom: 26 };
  const LANE_H = 22;

  let range = $state<TimeRange>(FULL_RANGE);
  let startInput = $state('');
  let endInput = $state('');
  let width = $state(0);
  let plotEl = $state<HTMLDivElement | null>(null);
  let hovered = $state<BrushEvent | null>(null);
  let tip = $state({ x: 0, y: 0 });

  // ── Non-reactive drag bookkeeping ──────────────────────────────────────────
  let dragMode: 'new' | 'start' | 'end' | null = null;
  let dragAnchor = 0;
  let resizeObserver: ResizeObserver | null = null;

  const w = $derived(width || 720);
  const plotHeight = $derived(PAD.top + LANES.length * LANE_H + PAD.bottom);

  const extent = $derived(eventExtent(events));

  const scale = $derived.by(() => {
    // A graph with no dateable events still needs a domain, or every mark lands
    // on NaN and the axis disappears entirely.
    const now = Date.now();
    const start = extent.start ?? now - 30 * DAY_MS;
    const end = extent.end ?? now + 30 * DAY_MS;
    // A little breathing room so marks at the extremes are not cut in half.
    const pad = Math.max((end - start) * 0.03, DAY_MS / 2);
    return scaleTime()
      .domain([new Date(start - pad), new Date(end + pad)])
      .range([PAD.left, Math.max(PAD.left + 1, w - PAD.right)]);
  });

  const ticks = $derived.by(() => {
    const count = Math.max(2, Math.floor((w - PAD.left - PAD.right) / 110));
    const format = scale.tickFormat(count);
    return scale.ticks(count).map((d) => ({ x: scale(d), label: format(d) }));
  });

  const marks = $derived.by(() =>
    events
      .map((e) => {
        const from = eventTime(e.date);
        if (from === null) return null;
        const to = eventTime(e.dateEnd) ?? from;
        const x1 = scale(new Date(Math.min(from, to)));
        const x2 = scale(new Date(Math.max(from, to)));
        return {
          event: e,
          lane: laneOf(e.type),
          colour: colourOf(e.type),
          x1,
          // A same-day event is a dot; a span is a bar with a minimum width so
          // a two-day programme is still visible on a two-year axis.
          x2: Math.max(x2, x1 + 2),
          span: x2 - x1 > 3,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  );

  const selection = $derived.by(() => {
    if (isFullRange(range)) return null;
    const { start, end } = normaliseRange(range);
    const domain = scale.domain();
    const x1 = scale(new Date(start ?? +domain[0]));
    const x2 = scale(new Date(end ?? +domain[1]));
    return { x1: Math.min(x1, x2), x2: Math.max(x1, x2) };
  });

  const inRange = $derived(eventsInRange(events, range));
  const inRangeIds = $derived(new Set(inRange.map((e) => e.id)));
  const undated = $derived(events.length - marks.length);

  const laneY = (lane: number) => PAD.top + lane * LANE_H + LANE_H / 2;

  function timeAt(clientX: number): number {
    const rect = plotEl?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    const [lo, hi] = scale.range();
    return +scale.invert(Math.min(hi, Math.max(lo, x)));
  }

  /** One place that both writes the range and mirrors it into the text fields. */
  function setRange(next: TimeRange, syncInputs = true) {
    range = normaliseRange(next);
    if (syncInputs) {
      startInput = toDateInput(range.start);
      endInput = toDateInput(range.end);
    }
  }

  function emit() {
    onChange?.({
      range,
      eventIds: inRange.map((e) => e.id),
      entityIds: entityIdsInRange(events, range),
    });
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const t = timeAt(event.clientX);
    (event.currentTarget as Element).setPointerCapture(event.pointerId);

    const edge = selection ? nearEdge(event.clientX) : null;
    if (edge && range.start !== null && range.end !== null) {
      dragMode = edge;
      dragAnchor = edge === 'start' ? range.end : range.start;
    } else {
      dragMode = 'new';
      dragAnchor = t;
      setRange({ start: t, end: t });
    }
    event.preventDefault();
  }

  /** Which handle the pointer is grabbing, if any. 6px is a comfortable target. */
  function nearEdge(clientX: number): 'start' | 'end' | null {
    if (!selection) return null;
    const rect = plotEl?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    if (Math.abs(x - selection.x1) <= 6) return 'start';
    if (Math.abs(x - selection.x2) <= 6) return 'end';
    return null;
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragMode) return;
    setRange({ start: dragAnchor, end: timeAt(event.clientX) });
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragMode) return;
    dragMode = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
    // A click with no drag is a request to clear, not a zero-width window.
    if (range.start !== null && range.end !== null && Math.abs(range.end - range.start) < DAY_MS / 4) {
      setRange(FULL_RANGE);
    }
    emit();
  }

  function applyInputs() {
    setRange(parseRangeInputs(startInput, endInput), false);
    emit();
  }

  function clear() {
    setRange(FULL_RANGE);
    emit();
  }

  $effect(() => {
    const el = plotEl;
    if (!el) return;
    resizeObserver = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
    });
    resizeObserver.observe(el);
    width = el.getBoundingClientRect().width;
    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });
</script>

<div class="brush">
  <div class="plot" bind:this={plotEl} style="height: {plotHeight}px;">
    <svg
      width="100%"
      height={plotHeight}
      role="img"
      aria-label="Timeline of {events.length} events. Use the date fields below to set a range."
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      <!-- Lane guides -->
      {#each LANES as lane, i (lane)}
        <line
          x1={PAD.left}
          x2={w - PAD.right}
          y1={laneY(i)}
          y2={laneY(i)}
          stroke="var(--divider)"
          stroke-width="1"
        />
        <text class="lane-label" x={PAD.left} y={laneY(i) - 7} fill="var(--text-ghost)">{lane}</text>
      {/each}

      {#if selection}
        <rect
          class="sel"
          x={selection.x1}
          y={PAD.top - 8}
          width={Math.max(1, selection.x2 - selection.x1)}
          height={LANES.length * LANE_H + 8}
        />
        <line class="handle" x1={selection.x1} x2={selection.x1} y1={PAD.top - 8} y2={PAD.top + LANES.length * LANE_H} />
        <line class="handle" x1={selection.x2} x2={selection.x2} y1={PAD.top - 8} y2={PAD.top + LANES.length * LANE_H} />
      {/if}

      <!-- Marks -->
      {#each marks as m (m.event.id)}
        {#if m.span}
          <rect
            x={m.x1}
            y={laneY(m.lane) - 4}
            width={m.x2 - m.x1}
            height="8"
            rx="2"
            fill={m.colour}
            opacity={isFullRange(range) || inRangeIds.has(m.event.id) ? 0.85 : 0.2}
            role="presentation"
            onpointerenter={() => {
              hovered = m.event;
              tip = { x: m.x1, y: laneY(m.lane) };
            }}
            onpointerleave={() => (hovered = null)}
          />
        {:else}
          <circle
            cx={m.x1}
            cy={laneY(m.lane)}
            r="4.5"
            fill={m.colour}
            opacity={isFullRange(range) || inRangeIds.has(m.event.id) ? 0.9 : 0.2}
            role="presentation"
            onpointerenter={() => {
              hovered = m.event;
              tip = { x: m.x1, y: laneY(m.lane) };
            }}
            onpointerleave={() => (hovered = null)}
          />
        {/if}
      {/each}

      <!-- Axis -->
      <line
        x1={PAD.left}
        x2={w - PAD.right}
        y1={PAD.top + LANES.length * LANE_H}
        y2={PAD.top + LANES.length * LANE_H}
        stroke="var(--card-border)"
        stroke-width="1"
      />
      {#each ticks as t (t.label)}
        <line
          x1={t.x}
          x2={t.x}
          y1={PAD.top + LANES.length * LANE_H}
          y2={PAD.top + LANES.length * LANE_H + 4}
          stroke="var(--card-border)"
        />
        <text class="tick" x={t.x} y={plotHeight - 8} fill="var(--text-ghost)" text-anchor="middle">{t.label}</text>
      {/each}
    </svg>

    {#if hovered}
      <div class="tip" style="left: {tip.x}px; top: {tip.y + 12}px;">
        <span class="tip-date">{hovered.date}{hovered.dateEnd ? ` → ${hovered.dateEnd}` : ''}</span>
        <span class="tip-title">{hovered.title}</span>
        {#if hovered.entityName}<span class="tip-ent">{hovered.entityName}</span>{/if}
      </div>
    {/if}
  </div>

  <div class="controls">
    <span class="hint">Drag across the chart to select a window</span>

    <label class="field">
      <span>From</span>
      <input type="date" value={startInput} onchange={(e) => { startInput = e.currentTarget.value; applyInputs(); }} />
    </label>
    <label class="field">
      <span>To</span>
      <input type="date" value={endInput} onchange={(e) => { endInput = e.currentTarget.value; applyInputs(); }} />
    </label>

    <button type="button" class="clear" onclick={clear} disabled={isFullRange(range)}>Clear</button>

    <span class="count">
      {inRange.length} of {events.length} events
      {#if undated > 0}<span class="undated" title="Events whose date could not be read">· {undated} undated</span>{/if}
    </span>
  </div>
</div>

<style>
  .brush {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .plot {
    position: relative;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    overflow: hidden;
  }
  svg {
    display: block;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .lane-label {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tick {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .sel {
    fill: var(--accent-tint-14);
    stroke: var(--accent-tint-35);
    stroke-width: 1;
  }
  .handle {
    stroke: var(--accent);
    stroke-width: 1.5;
    cursor: ew-resize;
  }

  .tip {
    position: absolute;
    z-index: 20;
    transform: translateX(-50%);
    max-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    /* Floating over the chart — opaque, never a tint. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    pointer-events: none;
  }
  .tip-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .tip-title {
    font-size: var(--fs-label);
    color: var(--text-primary);
    line-height: 1.3;
  }
  .tip-ent {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }
  .hint,
  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .count {
    margin-left: auto;
    text-transform: none;
    letter-spacing: 0;
  }
  .undated {
    color: var(--warn);
  }

  .field {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .field span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .field input {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 4px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .field input:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .clear {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--t-fast) var(--ease-out);
  }
  .clear:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .clear:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
