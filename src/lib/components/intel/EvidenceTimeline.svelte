<script lang="ts">
  // The entity card's temporal section: how old this entity is, how much that
  // costs it, and the shape of the evidence behind it.
  //
  // Three readings of one set of numbers, deliberately together:
  //   strip      a tick per piece of evidence on a time axis — click through
  //   decay      the curve that turns that age into a freshness weight
  //   sparkline  evidence per month, so a burst reads differently to a trickle
  //
  // DATES ARE OBSERVATION DATES, not ingest dates. `note.observedAt` is when the
  // thing happened (for mail, when it landed); `createdAt` is when the sweep
  // wrote the row, and every email note carries the same one. Anything plotted
  // on the ingest clock would show twelve weeks of correspondence as a single
  // spike on the night it was read.
  //
  // Drawn as bare SVG paths with no axes, ticks or gridlines, copying
  // `sparkPath()` in /jkai/doctor — the caption does the work a legend would.
  // Marks and the opacity-as-fade idiom come from TimelineBrush.svelte, which is
  // this folder's existing answer to "things on a time axis".
  //
  // Everything is $derived off the props. No $effect: this renders inside the
  // chat hover card, whose height is measured by a ResizeObserver to decide the
  // above/below flip, so a section that changes size after first paint makes the
  // card jump.

  import { recencyWeight, DEFAULT_HALF_LIFE_DAYS, RECENCY_FLOOR, MS_PER_DAY } from '$lib/jkai/intel/staleness';

  interface EvidenceNote {
    id: string;
    title: string;
    source: string;
    createdAt: string | Date;
    observedAt?: string | Date | null;
    href: string;
  }

  let {
    notes = [],
    histogram = [],
    evidenceAt = null,
    relevance = null,
    compact = false,
  }: {
    notes?: EvidenceNote[];
    histogram?: Array<{ month: string; count: number }>;
    /** When this entity was last observed, ISO. */
    evidenceAt?: string | null;
    relevance?: { score: number; confidence: number; freshness: number; ageDays: number | null } | null;
    compact?: boolean;
  } = $props();

  const W = 300;
  const H = 46;
  /** Room for the tick lane under the curve. */
  const LANE_Y = H - 9;
  const PAD = 5;

  const ms = (v: string | Date | null | undefined): number | null => {
    if (!v) return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) && t > 0 ? t : null;
  };

  /** Evidence that can be placed on a time axis, newest last. */
  const dated = $derived(
    notes
      .map((n) => ({ note: n, at: ms(n.observedAt) ?? ms(n.createdAt) }))
      .filter((d): d is { note: EvidenceNote; at: number } => d.at !== null)
      .sort((a, b) => a.at - b.at),
  );
  // Shown rather than hidden, exactly as TimelineBrush reports its undated rows:
  // a strip that silently drops evidence is worse than one that admits to it.
  const undated = $derived(notes.length - dated.length);

  const now = Date.now();
  const firstAt = $derived(dated.length ? dated[0].at : null);
  const lastAt = $derived(ms(evidenceAt) ?? (dated.length ? dated[dated.length - 1].at : null));

  /**
   * The window the strip covers: oldest evidence to today, with a floor so a
   * single-observation entity is not drawn on a zero-width axis.
   */
  const span = $derived.by(() => {
    const from = firstAt ?? now - 30 * MS_PER_DAY;
    const to = now;
    return { from: Math.min(from, to - MS_PER_DAY), to };
  });

  const xOf = (t: number) => {
    const f = (t - span.from) / (span.to - span.from || 1);
    return PAD + Math.max(0, Math.min(1, f)) * (W - PAD * 2);
  };

  /** The decay curve across the same window — y is the freshness weight. */
  const curve = $derived.by(() => {
    const steps = 44;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = span.from + ((span.to - span.from) * i) / steps;
      const ageDays = (now - t) / MS_PER_DAY;
      const w = recencyWeight(ageDays);
      // Scaled between the floor and 1 so the visible line uses the full height
      // rather than sitting in the top 15% of the box.
      const norm = (w - RECENCY_FLOOR) / (1 - RECENCY_FLOOR);
      const x = PAD + ((W - PAD * 2) * i) / steps;
      const y = LANE_Y - 4 - norm * (LANE_Y - 4 - PAD);
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(' ');
  });

  const marks = $derived(
    dated.map((d) => ({
      ...d,
      x: xOf(d.at),
      // Older evidence is drawn fainter, the same channel TimelineBrush uses to
      // push things out of focus.
      opacity: 0.25 + 0.6 * ((recencyWeight((now - d.at) / MS_PER_DAY) - RECENCY_FLOOR) / (1 - RECENCY_FLOOR)),
    })),
  );

  /** Monthly volume, as a bar per month with no gaps for empty months. */
  const bars = $derived.by(() => {
    if (histogram.length < 2) return [];
    const max = Math.max(...histogram.map((h) => h.count), 1);
    const bw = W / histogram.length;
    return histogram.map((h, i) => ({
      month: h.month,
      count: h.count,
      x: i * bw,
      w: Math.max(1, bw - 2),
      h: Math.max(1, (h.count / max) * 18),
    }));
  });

  const fmtDate = (t: number | null) =>
    t === null ? '—' : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

  const fmtAge = (days: number | null) => {
    if (days === null) return 'undated';
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 60) return `${Math.round(days)} days old`;
    return `${Math.round(days / 30.4)} months old`;
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<section class="temporal">
  <div class="head">
    <span class="lbl">Evidence</span>
    <span class="dates">{fmtDate(firstAt)} → {fmtDate(lastAt)}</span>
  </div>

  {#if dated.length}
    <svg class="strip" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img"
         aria-label="Evidence over time. {dated.length} dated source{dated.length === 1 ? '' : 's'}, {fmtAge(relevance?.ageDays ?? null)}.">
      <!-- The decay curve this entity's freshness is read off. -->
      <path class="decay" d={curve} />
      <line class="axis" x1={PAD} y1={LANE_Y} x2={W - PAD} y2={LANE_Y} />
      {#each marks as m (m.note.id)}
        <a href={m.note.href} target={m.note.href.startsWith('http') ? '_blank' : null}
           rel={m.note.href.startsWith('http') ? 'noopener noreferrer' : null}>
          <title>{m.note.title} · {m.note.source} · {fmtDate(m.at)}</title>
          <circle class="tick" cx={m.x} cy={LANE_Y} r="3.5" opacity={m.opacity} />
        </a>
      {/each}
      <!-- Today, where the entity currently sits on the curve. -->
      <circle class="today" cx={W - PAD} cy={LANE_Y} r="2" />
    </svg>
  {:else}
    <p class="none">No dated evidence.</p>
  {/if}

  {#if relevance}
    <p class="verdict">
      <b>{pct(relevance.score)}</b> relevant
      <span class="working">
        · {pct(relevance.confidence)} confidence × {pct(relevance.freshness)} freshness · {fmtAge(relevance.ageDays)}
      </span>
    </p>
  {/if}

  {#if !compact && bars.length}
    <div class="volume">
      <svg viewBox="0 0 {W} 20" preserveAspectRatio="none" role="img"
           aria-label="Evidence per month, {histogram.length} months.">
        {#each bars as b (b.month)}
          <rect x={b.x} y={20 - b.h} width={b.w} height={b.h}><title>{b.month}: {b.count}</title></rect>
        {/each}
      </svg>
      <span class="vmeta">{histogram.reduce((s, h) => s + h.count, 0)} over {histogram.length} months</span>
    </div>
  {/if}

  {#if undated > 0}
    <p class="undated">{undated} source{undated === 1 ? '' : 's'} with no date</p>
  {/if}
</section>

<style>
  .temporal {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .dates {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }

  .strip {
    display: block;
    width: 100%;
    height: 46px;
    margin-top: 4px;
    overflow: visible;
  }
  .decay {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.2;
    opacity: 0.45;
  }
  .axis {
    stroke: var(--card-border);
    stroke-width: 1;
  }
  .tick {
    fill: var(--accent-ink);
    cursor: pointer;
  }
  .tick:hover {
    fill: var(--accent);
    r: 5;
  }
  .today {
    fill: var(--text-ghost);
  }

  .verdict {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .verdict b {
    color: var(--text-primary);
  }
  .working {
    color: var(--text-ghost);
  }

  .volume {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
  .volume svg {
    flex: 1;
    height: 20px;
  }
  .volume rect {
    fill: var(--accent);
    opacity: 0.35;
  }
  .vmeta {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .none,
  .undated {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
