<script lang="ts">
  // 02 — TRAINING STRIP. Twelve weeks of moving time, and the one number the
  // dashboard reads off the end of it.
  //
  // The strip is `Bars` in its `strip` variant, not a second bar chart: a
  // fixed twelve-column grid, no axis, radius 0. The last three bars are
  // tinted because they are the shape the acute:chronic ratio beside them is
  // actually reading — the tint is the link between the picture and the
  // figure, so it is not decoration.
  //
  // The ratio only appears when `sufficiency === 'ok'`. ACWR needs fourteen
  // days before it means anything, and an insufficient one still returns a
  // number (0.00, zone `detraining`) — printing that in 44px Archivo Black
  // would be a confident statement about nothing.
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import type { TrailsStrip } from '$lib/trails/physio-service';
  import { formatDistance } from '$lib/trails/format';

  interface Props {
    strip: TrailsStrip;
  }

  let { strip }: Props = $props();

  /** The recent weeks the ratio is reading, marked in the strip. */
  const ACCENTED = 3;

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  /**
   * The week's Monday, split out of the string rather than put through a Date:
   * `weekStart` is already a local calendar day, and a UTC-midnight round trip
   * moves it either side of midnight depending on where the reader is.
   */
  function parts(day: string): { d: number; m: number } | null {
    const [y, m, d] = day.slice(0, 10).split('-');
    if (!y || !m || !d) return null;
    return { d: Number(d), m: Number(m) };
  }

  /** `8 Jun` for the first week of a month, then bare days: `15`, `22`. */
  function tickFor(day: string, previous: string | null): string {
    const p = parts(day);
    if (!p) return day;
    const prev = previous ? parts(previous) : null;
    return !prev || prev.m !== p.m ? `${p.d} ${MONTHS[p.m - 1]}` : String(p.d);
  }

  /** `6h`, `1h48m`, `48m` — a duration said the way it would be spoken. */
  function looseDuration(seconds: number): string {
    const total = Math.round(seconds);
    if (total <= 0) return 'nothing';
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}m`;
  }

  const weeks = $derived(strip.weeks ?? []);

  const bars = $derived.by((): Bar[] =>
    weeks.map((w, i) => {
      const recent = weeks.length - i;
      return {
        key: w.weekStart,
        tick: tickFor(w.weekStart, i > 0 ? weeks[i - 1].weekStart : null),
        value: w.totalS,
        readout: w.totalS
          ? `${looseDuration(w.totalS)}${w.totalDistanceM ? ` · ${formatDistance(w.totalDistanceM)}` : ''}`
          : 'no workouts',
        readoutSub: `week of ${tickFor(w.weekStart, null)}`,
        tone: recent === 1 ? 'accent' : recent <= ACCENTED ? 'accent-soft' : 'ink',
      };
    }),
  );

  const peak = $derived(
    weeks.reduce<{ weekStart: string; totalS: number } | null>(
      (best, w) => (best == null || w.totalS > best.totalS ? w : best),
      null,
    ),
  );
  const lastWeek = $derived(weeks.length ? weeks[weeks.length - 1] : null);

  const acwr = $derived(
    strip.strainAcwr && strip.strainAcwr.sufficiency === 'ok' ? strip.strainAcwr.value : null,
  );
  /** Olive is the one hue that means a number is where it should be. */
  const settled = $derived(acwr?.zone === 'optimal');

  const lede = $derived.by((): string => {
    if (!peak || peak.totalS <= 0) return 'Nothing recorded in the last twelve weeks.';
    const month = parts(peak.weekStart);
    const where = month ? ` in ${MONTHS_LONG[month.m - 1]}` : '';
    const gone = lastWeek ? looseDuration(lastWeek.totalS) : 'nothing';
    const tail = acwr
      ? ` The last ${ACCENTED} bars are the shape the dashboard's load ratio is reading.`
      : '';
    return `${looseDuration(peak.totalS)} a week at the peak${where}, ${gone} in the week just gone.${tail}`;
  });
</script>

<section class="ts">
  <div class="ts-inner">
    <div class="ts-chart">
      <Bars
        variant="strip"
        {bars}
        label="Training — last {weeks.length} weeks"
        caption="Moving time per week"
        height={118}
      />
      <p class="ts-lede">{lede}</p>
    </div>

    <div class="ts-side" class:settled>
      <p class="ts-side-label">Load ratio</p>
      {#if acwr}
        <p class="ts-ratio">{acwr.ratio.toFixed(2)}</p>
        <span class="ts-zone">{acwr.zone}</span>
      {:else}
        <p class="ts-ratio muted">—</p>
        <span class="ts-zone muted">Needs 14 days</span>
      {/if}
      <a class="ts-link" href="/health">Full dashboard →</a>
    </div>
  </div>
</section>

<style>
  .ts {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .ts-inner {
    max-width: 1500px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 210px;
    gap: clamp(24px, 3vw, 44px);
    align-items: end;
  }
  .ts-chart {
    min-width: 0;
  }

  .ts-lede {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    text-wrap: pretty;
    max-width: 76ch;
    margin: 16px 0 0;
  }

  .ts-side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    border-left: 3px solid var(--accent);
    padding-left: 18px;
  }
  .ts-side.settled {
    border-left-color: var(--good);
  }

  .ts-side-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .ts-ratio {
    font-family: var(--font-display);
    font-size: 44px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    color: var(--accent);
    margin: 0;
  }
  .ts-side.settled .ts-ratio {
    color: var(--good);
  }
  .ts-ratio.muted {
    color: var(--text-ghost);
  }

  .ts-zone {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    border: 1px solid var(--accent-tint-50);
    border-radius: 0;
    color: var(--accent);
    padding: 4px 10px;
  }
  .ts-side.settled .ts-zone {
    border-color: var(--good-line);
    color: var(--good);
  }
  .ts-zone.muted {
    border-color: var(--line-strong);
    color: var(--text-muted);
    font-weight: 500;
  }

  .ts-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    margin-top: 6px;
    transition: color 0.2s ease-out;
  }
  .ts-link:hover {
    color: var(--accent-hover);
  }

  /* Below 860px the two columns stack; the ratio keeps its accent rule. */
  @media (max-width: 860px) {
    .ts-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
