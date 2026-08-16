<script lang="ts">
  type HrvLow = { day: string; ms: number } | null;
  type HardestDay = { day: string; strain: number } | null;
  type WeekStats = {
    recToday: number;
    recAvg7: number;
    hrvToday: number;
    hrvLow: HrvLow;
    rhrToday: number;
    rhrBaseline: number;
    sleepToday: number;
    sleepAvg7: number;
    hardestDay: HardestDay;
    stepsToday: number;
  } | null;

  let { stats } = $props<{ stats: WeekStats }>();

  type Cell = { label: string; value: string; sub: string };

  const cells = $derived.by<Cell[]>(() => {
    if (!stats) return [];
    const s = stats;
    const out: Cell[] = [
      {
        label: '7-DAY RECOVERY',
        value: `${s.recAvg7}%`,
        sub: `today ${s.recToday}%`
      },
      {
        label: '7-DAY SLEEP',
        value: `${s.sleepAvg7.toFixed(1)}h`,
        sub: `today ${s.sleepToday.toFixed(1)}h`
      },
      {
        label: 'RHR BASELINE',
        value: `${s.rhrBaseline} bpm`,
        sub: `today ${s.rhrToday}`
      }
    ];
    if (s.hrvLow) {
      out.push({
        label: 'LOWEST HRV',
        value: `${s.hrvLow.ms}ms`,
        sub: s.hrvLow.day
      });
    }
    if (s.hardestDay) {
      out.push({
        label: 'HARDEST DAY',
        value: `strain ${s.hardestDay.strain}`,
        sub: s.hardestDay.day
      });
    }
    return out;
  });
</script>

{#if stats}
  <div class="win">
    {#each cells as cell, i (i)}
      <div class="win-cell">
        <p class="win-label">{cell.label}</p>
        <p class="win-value">{cell.value}</p>
        {#if cell.sub}
          <p class="win-sub">{cell.sub}</p>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .win {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(clamp(140px, 30vw, 200px), 1fr));
    gap: 0;
    border-top: 2px solid var(--line-strong);
    border-bottom: 2px solid var(--line-strong);
    background: var(--bg);
  }
  .win-cell {
    padding: 14px 18px;
    border-right: 1px solid var(--line-hair);
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .win-cell:last-child {
    border-right: none;
  }
  .win-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .win-value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(22px, 4vw, 28px);
    letter-spacing: -0.02em;
    line-height: 1;
    margin: 0;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .win-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
</style>
