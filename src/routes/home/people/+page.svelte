<script lang="ts">
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { stamp } from '$lib/daydream/format';
  /**
   * The household room — /home/people. Moved out of /jkai/daydreams on
   * 2026-09-25 so the household's whereabouts live beside the rest of the home
   * (the old URL 308s here). The per-person findings section went with the
   * daydream sweep and hypothesis proposer in P4a the same day.
   *
   * Read off the trail, never asked for: where everyone is and what today
   * looked like. The old tab opened on five cards each carrying a nested three-row
   * table, then a map, then an accordion of three more tables per person. It
   * opens on one rollup now: one even cell per head, and the day's arithmetic
   * in a single table underneath.
   *
   */
  import type { PageData } from './$types';
  import type { Tone } from '$lib/daydream/priority';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';

  let { data }: { data: PageData } = $props();

  const members = $derived(data.family.members);

  /** Over this many minutes without a fix and the answer is "we don't know",
   *  which is a different answer from "at home" and must not look like one. */
  const STALE_MINS = 30;

  // ── Formatting ───────────────────────────────────────────────────────────
  function cap(sub: string): string {
    return sub.charAt(0).toUpperCase() + sub.slice(1);
  }

  /** Minutes since midnight as a clock face. */
  function clock(mins: number | null): string {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function outFor(mins: number): string {
    if (mins >= 60) return `${Math.round(mins / 6) / 10}h`;
    return `${mins}m`;
  }

  function since(mins: number | null): string {
    if (mins == null) return 'never';
    if (mins < 5) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  /**
   * When the last fix landed, said outright. `since` is the scannable one and
   * it stays, but "17h ago" is useless the moment you want to line a fix up
   * against a calendar entry. Pinned to Europe/London because the server runs
   * UTC and a 00:40 BST fix would otherwise be filed a day early.
   */
  const STAMP_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // ── The rollup ───────────────────────────────────────────────────────────
  type Member = PageData['family']['members'][number];

  function memberTone(m: Member): Tone {
    if (m.ageMins == null) return 'quiet';
    if (m.ageMins > STALE_MINS) return 'watch';
    return m.isHome ? 'good' : 'steady';
  }

  function memberValue(m: Member): string {
    if (m.ageMins == null) return '—';
    return m.isHome ? 'home' : 'out';
  }

  function memberSub(m: Member): string {
    if (m.ageMins == null) return 'No position on the trail. Unknown is not the same answer as home.';
    const bits: string[] = [];
    if (m.placeLabel) bits.push(`At ${m.placeLabel}`);
    else if (!m.isHome && m.distanceHomeKm != null) bits.push(`${m.distanceHomeKm} km from home`);
    if (m.batteryPct != null) bits.push(`battery ${m.batteryPct}%`);
    bits.push(`seen ${since(m.ageMins)}`);
    return bits.join(' · ');
  }

  const cells = $derived<RollupCell[]>(
    members.map((m) => ({
      key: m.subject,
      label: cap(m.subject),
      value: memberValue(m),
      sub: memberSub(m),
      tone: memberTone(m),
      corner: `${outFor(m.today.minutesOut)} out`,
          })),
  );

  const away = $derived(members.filter((m) => m.ageMins != null && m.isHome === false).length);
  const unknown = $derived(members.filter((m) => m.ageMins == null || m.ageMins > STALE_MINS).length);
  const home = $derived(members.filter((m) => m.ageMins != null && m.isHome).length);
  const summary = $derived([
    { label: 'Home', value: String(home), sub: `of ${members.length}` },
    { label: 'Out', value: String(away), sub: 'on the trail' },
    { label: 'Unknown', value: String(unknown), sub: `no fix for ${STALE_MINS}m` },
  ]);
</script>

<HomeFrame
  path="/home/people"
  kicker="Home · People"
  title={['Where everyone', 'is, and was']}
  standfirst="Read off the family trail — Life360 through Home Assistant, sampled every two minutes and kept ninety days — never asked for."
  {summary}
  footer={['strangeramblings.com/home/people', 'Life360 via Home Assistant · 90-day trail', 'Owner-gated · the whole household, never shared']}
>

{#if data.loadError}
  <section class="band"><div class="inner"><LoadErrorCard kicker="The household did not load" message={data.loadError} /></div></section>
{/if}

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / The household, now"
      title={['Where', 'everyone is']}
      strap="Read off the trail, not asked for. A cell goes amber when the last fix is over half an hour old — an unknown position and a position at home are not the same answer."
    />

    {#if !members.length}
      <p class="lede">Nobody is on the trail.</p>
    {:else}
      <RollupGrid {cells} min={210} />

      <p class="note">
        {members.length} on the trail · {away} out · {unknown} without a fresh fix. The figure in
        each corner is how long they have been away from home today.
      </p>

      <!-- The day's arithmetic, once. It used to be a three-row table nested
           inside every card, which is five tables to answer one question. -->
      <div class="tbl-wrap today">
        <table class="tbl compact">
          <thead>
            <tr>
              <th>Person</th>
              <th>Where</th>
              <th class="right">First out</th>
              <th class="right">Out today</th>
              <th class="right">Places</th>
              <th class="right">Fixes</th>
              <th class="right">Battery</th>
              <th class="right">Last fix</th>
            </tr>
          </thead>
          <tbody>
            {#each members as m (m.subject)}
              <tr>
                <td class="cell-lead">{cap(m.subject)}</td>
                <td class="cell-wrap">
                  {#if m.ageMins == null}
                    not tracked
                  {:else if m.isHome}
                    at home
                  {:else if m.placeLabel}
                    at {m.placeLabel}
                  {:else if m.distanceHomeKm != null}
                    {m.distanceHomeKm} km out
                  {:else}
                    out
                  {/if}
                </td>
                <td class="right num">{clock(m.today.firstOutMins)}</td>
                <td class="right num">{outFor(m.today.minutesOut)}</td>
                <td class="right num">{m.today.placesVisited}</td>
                <td class="right num">{m.today.fixes}</td>
                <td class="right num" class:bad={m.batteryPct != null && m.batteryPct <= 25}>
                  {m.batteryPct == null ? '—' : `${m.batteryPct}%`}
                </td>
                <td class="right nowrap">{stamp(m.lastSeenAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

</HomeFrame>

<style>
  /* Room-specific only — `.band`, `.inner`, `.card`, `.tbl`, `.note`, `.lede`,
     `.link`, `.btn`, `.cta` all come from `.ds-vocab` (HomeFrame's DsVocab). */
  .today {
    margin-top: 22px;
  }
</style>
