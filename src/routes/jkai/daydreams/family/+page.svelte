<script lang="ts">
  import { postThought } from '$lib/daydream/feed-client';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { stamp } from '$lib/daydream/format';
  /**
   * The household room.
   *
   * Read off the trail, never asked for: where everyone is, what today looked
   * like, and — since the family backfill gave four more people a year of
   * history — what the sweep and the hypothesis proposer have made of each of
   * them. The old tab opened on five cards each carrying a nested three-row
   * table, then a map, then an accordion of three more tables per person. It
   * opens on one rollup now: one even cell per head, and the day's arithmetic
   * in a single table underneath.
   *
   * Positions are the one thing NOT in the page payload. A lat/lon leaves the
   * server only through the on-demand `family_now` action, for one owner-gated
   * render, held for the life of this component and never cached — the same
   * discipline the place-naming map established. The fetch fires on mount
   * because arriving at this route is the intent the old tab-open was.
   */
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import type { Tone } from '$lib/daydream/priority';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import FamilyMap, { type FamilyPosition } from '$lib/components/jkai/daydream/FamilyMap.svelte';
  import FamilyPerson from '$lib/components/jkai/daydream/rooms/FamilyPerson.svelte';

  let { data }: { data: PageData } = $props();

  const members = $derived(data.family.members);
  const detail = $derived(data.family.detail);

  /** Over this many minutes without a fix and the answer is "we don't know",
   *  which is a different answer from "at home" and must not look like one. */
  const STALE_MINS = 30;

  // ── Positions, on demand ─────────────────────────────────────────────────
  let famPositions = $state<FamilyPosition[] | null>(null);
  let famLoading = $state(false);
  let famError = $state<string | null>(null);

  async function loadFamilyMap() {
    famLoading = true;
    famError = null;
    const r = await postThought<{ positions?: FamilyPosition[] }>({ action: 'family_now' });
    if (!r.ok) {
      famError = r.error ?? 'could not load the map';
      famPositions = null;
    } else {
      famPositions = r.out.positions ?? [];
    }
    famLoading = false;
  }


  onMount(() => {
    void loadFamilyMap();
  });

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
      href: `#p-${m.subject}`,
    })),
  );

  const away = $derived(members.filter((m) => m.ageMins != null && m.isHome === false).length);
  const unknown = $derived(members.filter((m) => m.ageMins == null || m.ageMins > STALE_MINS).length);
</script>

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
                <td class="cell-lead"><a class="link" href="#p-{m.subject}">{cap(m.subject)}</a></td>
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

<section class="band sunken">
  <div class="inner">
    <SectionHead
      kicker="B / On the map"
      title={['Everyone,', 'plotted']}
      strap="Fetched on demand and held only for this render — positions never ride the page payload and are never cached."
    >
      {#snippet aside()}
        {#if famPositions}
          <button type="button" class="btn" onclick={loadFamilyMap} disabled={famLoading}>
            Refresh positions
          </button>
        {:else}
          <button type="button" class="cta" onclick={loadFamilyMap} disabled={famLoading}>
            Show the map
          </button>
        {/if}
      {/snippet}
    </SectionHead>

    {#if famLoading}
      <p class="lede">Locating everyone…</p>
    {:else if famError}
      <div class="card t-urgent">
        <p class="card-body">{famError}</p>
        <div class="card-actions">
          <button type="button" class="btn" onclick={loadFamilyMap}>Try again</button>
        </div>
      </div>
    {:else if famPositions && famPositions.length}
      <FamilyMap positions={famPositions} />
    {:else if famPositions}
      <p class="lede">Nobody has a recent position.</p>
    {/if}
  </div>
</section>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="C / Each person"
      title={['What the sweep', 'found, per head']}
      strap="Questions are proposed per person nightly, and the false-discovery correction is applied within that person — never across the household."
    />

    {#if !members.length}
      <p class="lede">Nobody on the trail, so nothing has been asked about anybody.</p>
    {:else}
      {#each members as m (m.subject)}
        <FamilyPerson
          subject={m.subject}
          detail={detail[m.subject]}
          lastSeen={m.lastSeenAt ? stamp(m.lastSeenAt) : null}
        />
      {/each}
    {/if}
  </div>
</section>

<style>
  /* Room-specific only — `.band`, `.inner`, `.card`, `.tbl`, `.note`, `.lede`,
     `.link`, `.btn`, `.cta` all come from the layout's `.ds-vocab`. */
  .today {
    margin-top: 22px;
  }
</style>
