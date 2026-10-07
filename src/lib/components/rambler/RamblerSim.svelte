<script lang="ts">
  // The drives model on sample days: change the clock, the weather and the
  // day, and watch what he would most likely do, hour by hour.
  import { NO_DAY } from '$lib/landing/ramblers/day';
  import { score, startDrives, type Band, type Choice, type DriveInput, type Sky } from '$lib/landing/ramblers/drives';
  import DriveReadout from './DriveReadout.svelte';
  import { CHOICE_LABEL } from './labels';

  let hour = $state(11);
  let weekday = $state(true);
  let sky = $state<Sky>('cloudy');
  let temp = $state(13);
  let pulse = $state(75);
  let moving = $state<'still' | 'some' | 'active' | 'none'>('still');
  let sleep = $state<Band | 'none'>('mid');
  let steps = $state<'low' | 'mid' | 'high'>('mid');

  const input = $derived<DriveInput>({
    hour,
    weekday,
    sky,
    temp,
    pulse,
    day: { ...NO_DAY, steps, moving: moving === 'none' ? null : moving },
    sleep: sleep === 'none' ? null : sleep,
    recovery: null,
  });

  const ROWS: Choice[] = ['sleep', 'nap', 'eat', 'tea', 'study', 'think', 'garden', 'wander', 'run', 'workout', 'cycle', 'tv', 'sofa', 'meditate', 'stargaze', 'puddle'];
  const byHour = $derived(
    Array.from({ length: 24 }, (_, h) => {
      const m = new Map<Choice, number>();
      for (const o of score(startDrives({ ...input, hour: h + 0.5 }))) m.set(o.a, o.p);
      return m;
    }),
  );
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
</script>

<div class="sim">
  <div class="controls">
    <label class="field"><span>Time <output>{hhmm(hour)}</output></span><input type="range" min="0" max="23.75" step="0.25" bind:value={hour} /></label>
    <label class="field"><span>Day</span>
      <select bind:value={weekday}><option value={true}>Weekday</option><option value={false}>Weekend</option></select>
    </label>
    <label class="field"><span>Sky</span>
      <select bind:value={sky}>
        <option value="clear">Clear</option><option value="cloudy">Cloudy</option><option value="rain">Rain</option><option value="thunderstorm">Thunderstorm</option><option value="snow">Snow</option>
      </select>
    </label>
    <label class="field"><span>Temperature <output>{temp} °C</output></span><input type="range" min="-5" max="32" step="1" bind:value={temp} /></label>
    <label class="field"><span>Pulse <output>{pulse} bpm</output></span><input type="range" min="50" max="140" step="1" bind:value={pulse} /></label>
    <label class="field"><span>Moving lately</span>
      <select bind:value={moving}><option value="still">Sat still</option><option value="some">A little</option><option value="active">Lots</option><option value="none">Unknown</option></select>
    </label>
    <label class="field"><span>Last night</span>
      <select bind:value={sleep}><option value="low">Short</option><option value="mid">Normal</option><option value="high">Long</option><option value="none">Unknown</option></select>
    </label>
    <label class="field"><span>Steps so far</span>
      <select bind:value={steps}><option value="low">Few</option><option value="mid">Some</option><option value="high">Lots</option></select>
    </label>
  </div>
  <div class="out">
    <DriveReadout {input} />
    <div class="heat-wrap">
      <h3>His day at a glance, with these settings</h3>
      <div class="heat" role="img" aria-label="How likely each activity is in each hour of the day">
        <span></span>
        {#each byHour as _, h (h)}<span class="hh" class:now={h === Math.floor(hour)}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>{/each}
        {#each ROWS as a (a)}
          <span class="rl">{CHOICE_LABEL[a]}</span>
          {#each byHour as m, h (h)}
            <span class="c" class:now={h === Math.floor(hour)} style:opacity={(0.04 + 0.96 * Math.pow(m.get(a) ?? 0, 0.65)).toFixed(3)} title="{CHOICE_LABEL[a]} at {String(h).padStart(2, '0')}:30, {Math.round((m.get(a) ?? 0) * 100)}%"></span>
          {/each}
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .sim {
    display: grid;
    grid-template-columns: 15rem 1fr;
    gap: 2rem;
  }
  @media (max-width: 820px) {
    .sim {
      grid-template-columns: 1fr;
    }
  }
  .controls {
    display: grid;
    gap: 0.9rem;
    align-content: start;
  }
  .field {
    display: grid;
    gap: 0.3rem;
  }
  .field > span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
  }
  .field output {
    color: var(--text-primary);
    letter-spacing: 0;
  }
  select {
    font: inherit;
    font-size: 0.95rem;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 0.35rem 0.5rem;
  }
  input[type='range'] {
    accent-color: var(--accent);
    width: 100%;
  }
  .out {
    display: grid;
    gap: 1.75rem;
    min-width: 0;
  }
  h3 {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    font-weight: 400;
    margin: 0 0 0.6rem;
  }
  .heat-wrap {
    overflow-x: auto;
  }
  .heat {
    display: grid;
    grid-template-columns: 7rem repeat(24, minmax(0.9rem, 1fr));
    gap: 2px;
    min-width: 32rem;
  }
  .hh {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-align: center;
  }
  .hh.now {
    color: var(--accent);
  }
  .rl {
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    align-self: center;
  }
  .c {
    height: 0.9rem;
    background: var(--accent);
  }
  .c.now {
    outline: 1.5px solid var(--text-primary);
  }
</style>
