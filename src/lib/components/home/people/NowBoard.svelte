<script lang="ts">
  /**
   * The ink band at the top of /home/people: the map, and one row per person —
   * where they are (the live cards, scoped in the load) and where they are
   * likely going next (the forecast: a live arrival window, or the routine
   * due from where they are now). `next` is null while the forecast streams
   * and when it failed; a row then just shows where the person is.
   */
  import CircleMap from '$lib/components/home/CircleMap.svelte';
  import { nowLabel, nowStatus, nowSub, type NowStatus } from '$lib/home/presence/now';
  import type { NextMove, WatchItem } from '$lib/home/presence/forecast';
  import { cap, clock, ofDays } from './format';

  type Member = {
    subject: string;
    notSharing?: boolean;
    isHome: boolean | null;
    placeLabel: string | null;
    distanceHomeKm: number | null;
    batteryPct: number | null;
    ageMins: number | null;
    lastSeenAt: Date | string | null;
  };
  let {
    members,
    positions,
    names,
    links,
    next,
    watch,
    pending,
  }: {
    members: Member[];
    positions: Array<{ subject: string; lat: number; lon: number; at: string; isHome: boolean | null }>;
    names: Map<string, string>;
    links: Record<string, string>;
    next: NextMove[] | null;
    watch: WatchItem[];
    pending: boolean;
  } = $props();

  const nameOf = (s: string) => names.get(s) ?? cap(s);
  const PILL: Record<NowStatus, string> = { home: 'Home', out: 'Out', unknown: 'Last known', off: 'Not sharing' };
  const nextOf = (s: string) => next?.find((n) => n.subject === s) ?? null;
  const watchOf = (s: string) => watch.find((w) => w.subject === s) ?? null;
</script>

<section class="nb" aria-labelledby="nb-title">
  <div class="nb-inner">
    <div class="nb-map">
      <p class="nb-kicker">Now</p>
      <h2 id="nb-title">Everyone, right now</h2>
      {#if positions.length}
        <CircleMap positions={positions.map((p) => ({ ...p, label: nameOf(p.subject) }))} />
      {:else}
        <p class="nb-empty">No one is sharing a location just now.</p>
      {/if}
    </div>
    <div class="nb-rows">
      <p class="nb-kicker">Next</p>
      <h2>Who is going where</h2>
      {#if !members.length}
        <p class="nb-empty">Nobody is on the trail.</p>
      {/if}
      <ul>
        {#each members as m (m.subject)}
          {@const status = nowStatus(m)}
          {@const move = nextOf(m.subject)}
          {@const flag = watchOf(m.subject)}
          <li class="nb-row">
            <div class="nb-who">
              {#if links[m.subject]}
                <a href={links[m.subject]} data-sveltekit-noscroll>{nameOf(m.subject)}</a>
              {:else}
                <span>{nameOf(m.subject)}</span>
              {/if}
              <small>{m.notSharing ? 'Location sharing is off' : nowSub(m)}</small>
            </div>
            <div class="nb-next">
              {#if move?.kind === 'arriving'}
                <span class="nb-eta">{clock(move.arriveFrom)}–{clock(move.arriveTo)}</span>
                <span class="nb-to">arriving {move.to}</span>
                <small>Left {move.from} at {clock(move.leaveAt)} · {move.days} similar trips · no live traffic</small>
              {:else if move}
                <span class="nb-eta">{clock(move.leaveAt)}</span>
                <span class="nb-to">usually leaves for {move.to}</span>
                <small>{ofDays(move.days, move.of, move.dayType)} · there by {clock(move.arriveFrom)}–{clock(move.arriveTo)}</small>
              {:else if flag}
                <span class="nb-to">{flag.title}</span>
              {:else if pending}
                <small>Reading the routine…</small>
              {/if}
            </div>
            <span
              class="nb-pill"
              data-tone={flag ? 'watch' : move?.kind === 'arriving' ? 'moving' : status}
            >{flag ? 'Look' : move?.kind === 'arriving' ? 'On the way' : m.notSharing ? 'Off' : PILL[status] ?? nowLabel(m)}</span>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<style>
  .nb {
    background: var(--text-primary);
    color: var(--bg);
  }
  .nb-inner {
    width: min(1400px, 100%);
    margin: 0 auto;
    padding: 22px clamp(16px, 3vw, 44px) 26px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr);
    gap: 28px;
  }
  @media (max-width: 900px) {
    .nb-inner {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .nb-kicker {
    margin: 0 0 4px;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  h2 {
    margin: 0 0 14px;
    font: var(--fs-display-xs) var(--font-display);
  }
  .nb-empty {
    color: rgb(237 228 212 / 72%);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .nb-row {
    display: grid;
    grid-template-columns: minmax(110px, 0.8fr) minmax(0, 2fr) auto;
    gap: 4px 16px;
    align-items: baseline;
    padding: 11px 0;
    border-top: 1px solid rgb(237 228 212 / 16%);
  }
  @media (max-width: 560px) {
    .nb-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .nb-next {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
  .nb-who a,
  .nb-who span {
    font-weight: 700;
    color: var(--bg);
    text-decoration: none;
  }
  .nb-who a:hover {
    text-decoration: underline;
  }
  .nb-who a:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label);
    color: rgb(237 228 212 / 72%);
  }
  .nb-eta {
    font: var(--fs-body-lg) var(--font-display);
    color: var(--accent-ink-on-dark);
    margin-right: 8px;
    white-space: nowrap;
  }
  .nb-to {
    font-size: var(--fs-body-sm);
  }
  .nb-pill {
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 2px;
    white-space: nowrap;
    background: rgb(237 228 212 / 10%);
    color: rgb(237 228 212 / 80%);
  }
  .nb-pill[data-tone='home'] {
    background: rgb(138 154 91 / 22%);
    color: var(--good-on-dark);
  }
  .nb-pill[data-tone='moving'] {
    background: rgb(127 184 192 / 20%);
    color: var(--accent-ink-on-dark);
  }
  .nb-pill[data-tone='watch'] {
    background: rgb(232 134 58 / 22%);
    color: var(--accent-on-dark);
  }
</style>
