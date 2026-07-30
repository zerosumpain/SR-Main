<script lang="ts">
  // No-code schedule picker that compiles to a 5-field cron expression, so a
  // non-developer never has to hand-write `*/15 * * * *`. Fully controlled:
  // the UI state is derived from the incoming cron `value`, and every control
  // change compiles a fresh cron and calls onChange. Best-effort parse on the
  // way in means presets / raw-cron edits round-trip into the friendly UI.
  let { value, onChange }: { value: string; onChange: (cron: string) => void } = $props();

  type Freq = 'minutes' | 'hours' | 'daily' | 'weekly';

  const DOW = [
    { v: 1, label: 'Mon' },
    { v: 2, label: 'Tue' },
    { v: 3, label: 'Wed' },
    { v: 4, label: 'Thu' },
    { v: 5, label: 'Fri' },
    { v: 6, label: 'Sat' },
    { v: 0, label: 'Sun' },
  ];

  function pad(s: string | number): string {
    return String(s).padStart(2, '0');
  }
  function clamp(n: number, lo: number, hi: number): number {
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
  }
  function parseDow(dow: string): number[] {
    const out = new Set<number>();
    for (const seg of dow.split(',')) {
      const range = /^(\d+)-(\d+)$/.exec(seg);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i % 7);
      } else if (/^\d+$/.test(seg)) {
        out.add(Number(seg) % 7);
      }
    }
    return [...out];
  }

  type State = { freq: Freq; n: number; time: string; days: number[] };

  function parse(cron: string): State {
    const def: State = { freq: 'daily', n: 1, time: '08:00', days: [1, 2, 3, 4, 5] };
    const parts = (cron || '').trim().split(/\s+/);
    if (parts.length !== 5) return def;
    const [m, h, dom, mon, dow] = parts;
    const everyMin = /^\*\/(\d+)$/.exec(m);
    if (everyMin && h === '*' && dom === '*' && mon === '*' && dow === '*') {
      return { freq: 'minutes', n: Number(everyMin[1]), time: '08:00', days: [] };
    }
    const everyHr = /^\*\/(\d+)$/.exec(h);
    if (m === '0' && everyHr && dom === '*' && mon === '*' && dow === '*') {
      return { freq: 'hours', n: Number(everyHr[1]), time: '08:00', days: [] };
    }
    if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === '*' && mon === '*') {
      const time = `${pad(h)}:${pad(m)}`;
      if (dow === '*') return { freq: 'daily', n: 1, time, days: [] };
      return { freq: 'weekly', n: 1, time, days: parseDow(dow) };
    }
    return def;
  }

  const st = $derived(parse(value));

  function compile(s: State): string {
    const [h, m] = (s.time || '08:00').split(':').map((x) => Number(x));
    if (s.freq === 'minutes') return `*/${clamp(s.n, 1, 59)} * * * *`;
    if (s.freq === 'hours') return `0 */${clamp(s.n, 1, 23)} * * *`;
    if (s.freq === 'daily') return `${clamp(m, 0, 59)} ${clamp(h, 0, 23)} * * *`;
    const days = s.days.length ? [...s.days].sort((a, b) => a - b).join(',') : '1-5';
    return `${clamp(m, 0, 59)} ${clamp(h, 0, 23)} * * ${days}`;
  }

  function setFreq(freq: Freq) {
    const n = freq === 'minutes' ? (st.freq === 'minutes' ? st.n : 15) : freq === 'hours' ? (st.freq === 'hours' ? st.n : 1) : st.n;
    const days = freq === 'weekly' && st.days.length === 0 ? [1, 2, 3, 4, 5] : st.days;
    onChange(compile({ ...st, freq, n, days }));
  }
  function setN(n: number) { onChange(compile({ ...st, n })); }
  function setTime(time: string) { onChange(compile({ ...st, time: time || '08:00' })); }
  function toggleDay(d: number) {
    const days = st.days.includes(d) ? st.days.filter((x) => x !== d) : [...st.days, d];
    onChange(compile({ ...st, freq: 'weekly', days }));
  }

  function describe(s: State): string {
    if (s.freq === 'minutes') return `Every ${clamp(s.n, 1, 59)} minute${s.n === 1 ? '' : 's'}`;
    if (s.freq === 'hours') return `Every ${clamp(s.n, 1, 23)} hour${s.n === 1 ? '' : 's'}`;
    if (s.freq === 'daily') return `Every day at ${s.time}`;
    const labels = DOW.filter((d) => s.days.includes(d.v)).map((d) => d.label);
    const when = labels.length === 0 ? 'no days selected' :
      labels.length === 7 ? 'every day' :
      JSON.stringify(s.days.sort((a, b) => a - b)) === JSON.stringify([1, 2, 3, 4, 5]) ? 'every weekday' :
      labels.join(', ');
    return `${when} at ${s.time}`;
  }
</script>

<div class="sb">
  <div class="sb-row">
    <select class="sb-sel" value={st.freq} onchange={(e) => setFreq((e.currentTarget as HTMLSelectElement).value as Freq)}>
      <option value="minutes">Every N minutes</option>
      <option value="hours">Every N hours</option>
      <option value="daily">Every day</option>
      <option value="weekly">On chosen days</option>
    </select>

    {#if st.freq === 'minutes' || st.freq === 'hours'}
      <span class="sb-lbl">every</span>
      <input
        class="sb-num"
        type="number"
        min="1"
        max={st.freq === 'minutes' ? 59 : 23}
        value={st.n}
        oninput={(e) => setN(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="sb-lbl">{st.freq === 'minutes' ? 'min' : 'hr'}</span>
    {:else}
      <span class="sb-lbl">at</span>
      <input class="sb-time" type="time" value={st.time} oninput={(e) => setTime((e.currentTarget as HTMLInputElement).value)} />
    {/if}
  </div>

  {#if st.freq === 'weekly'}
    <div class="sb-days">
      {#each DOW as d (d.v)}
        <button
          type="button"
          class="sb-day"
          class:sb-day-on={st.days.includes(d.v)}
          aria-pressed={st.days.includes(d.v)}
          onclick={() => toggleDay(d.v)}
        >{d.label}</button>
      {/each}
    </div>
  {/if}

  <p class="sb-preview">{describe(st)} <span class="sb-tz">· server time</span></p>
</div>

<style>
  .sb { display: flex; flex-direction: column; gap: 8px; }
  .sb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sb-lbl { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
  .sb-sel, .sb-num, .sb-time {
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    outline: none;
  }
  .sb-sel:focus, .sb-num:focus, .sb-time:focus { border-color: var(--text-muted); }
  .sb-num { width: 64px; }
  .sb-days { display: flex; gap: 4px; flex-wrap: wrap; }
  .sb-day {
    padding: 4px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .sb-day:hover { color: var(--text-primary); }
  .sb-day-on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .sb-preview { margin: 0; font-size: var(--fs-label); color: var(--text-primary); }
  .sb-tz { color: var(--text-ghost); font-size: var(--fs-label); }
</style>
