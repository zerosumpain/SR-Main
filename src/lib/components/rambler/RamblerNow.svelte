<script lang="ts">
  // What his drives say at this moment, from the same live readings the
  // landing page uses: the clock where jk is, the weather, the pulse when it
  // is fresh, and the day's coarse flags. Words, never readings.
  import { getContext, onMount } from 'svelte';
  import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
  import type { DayFlags } from '$lib/landing/ramblers/day';
  import { moodFor } from '$lib/landing/ramblers/mood';
  import type { DriveInput } from '$lib/landing/ramblers/drives';
  import type { VitalsStore } from '$lib/vitals/store.svelte';
  import DriveReadout from './DriveReadout.svelte';

  let { day }: { day: DayFlags } = $props();
  const vitals = getContext<VitalsStore | undefined>('vitals');

  let input: DriveInput | null = $state(null);
  let words: string[] = $state([]);

  function ownerClock(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: HEALTH_TIMEZONE, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { hour: (Number(get('hour')) % 24) + Number(get('minute')) / 60, weekday: !['Sat', 'Sun'].includes(get('weekday')) };
  }

  function read() {
    const s = vitals?.targetState;
    const clock = ownerClock();
    const pulse = s?.sources?.heartRate && !s.stale && s.pulse > 0 ? s.pulse : null;
    const m = moodFor({
      sky: s?.sources?.weather ? s.weather.condition : 'cloudy',
      temp: s?.weather.temp ?? 12,
      pulse,
      dayPhase: s?.dayPhase ?? 'day',
      day,
      hour: clock.hour,
      weekday: clock.weekday,
      sleep: day.sleep ?? null,
      recovery: day.recovery ?? null,
    });
    input = m.input;
    const w: string[] = [`it is ${String(Math.floor(clock.hour)).padStart(2, '0')}:${String(Math.floor((clock.hour % 1) * 60)).padStart(2, '0')} where jk is, on a ${clock.weekday ? 'weekday' : 'weekend'}`];
    if (s?.sources?.weather) w.push(`the weather there is ${s.weather.condition === 'thunderstorm' ? 'stormy' : s.weather.condition} and ${Math.round(s.weather.temp)} °C`);
    if (pulse !== null) w.push(pulse >= 100 && !day.exercised ? "jk's pulse is up" : pulse < 65 ? "jk's pulse is calm" : "jk's pulse is ordinary");
    if (day.moving === 'still') w.push('he has been sat still lately');
    else if (day.moving === 'active') w.push('he has been on his feet lately');
    if (day.exercised) w.push('jk has exercised today');
    if (day.steps === 'low') w.push('a quiet day on his feet so far');
    else if (day.steps === 'high') w.push('a busy day on his feet');
    if (day.sleep === 'low') w.push('a short night last night');
    else if (day.sleep === 'high') w.push('a long sleep last night');
    if (day.recovery === 'low') w.push('running on empty today');
    words = w;
  }

  onMount(() => {
    read();
    const id = setInterval(read, 30_000);
    return () => clearInterval(id);
  });
</script>

{#if input}
  <p class="because">Right now {words.join(', ')}.</p>
  <DriveReadout {input} />
{:else}
  <p class="because">Reading the clock and the weather…</p>
{/if}

<style>
  .because {
    font-size: 1.0625rem;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 0 0 1.25rem;
    max-width: 44rem;
  }
</style>
