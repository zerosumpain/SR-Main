<script lang="ts">
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { stamp } from '$lib/daydream/format';
  /**
   * The household room — /home/people. Moved out of /jkai/daydreams on
   * 2026-09-25 so the household's whereabouts live beside the rest of the home
   * (the old URL 308s here); the reads are unchanged, and the per-person
   * findings still come from the daydream sweep.
   *
   * Read off the trail, never asked for: where everyone is, what today looked
   * like, and — since the family backfill gave four more people a year of
   * history — what the sweep and the hypothesis proposer have made of each of
   * them. The old tab opened on five cards each carrying a nested three-row
   * table, then a map, then an accordion of three more tables per person. It
   * opens on one rollup now: one even cell per head, and the day's arithmetic
   * in a single table underneath.
   *
   * Two viewers (2026-09-26): the owner, and a household member signed in with
   * the 'household' role. What each receives is decided in the load
   * (`scopeHousehold`), not here — for a household viewer another person's
   * `today` is null, a person not sharing carries no position at all, and
   * `detail` is empty. This page only has to draw those gaps honestly.
   */
  import type { PageData } from './$types';
  import type { Tone } from '$lib/daydream/priority';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import FamilyPerson from '$lib/components/jkai/daydream/rooms/FamilyPerson.svelte';

  let { data }: { data: PageData } = $props();

  const members = $derived(data.family.members);
  const detail = $derived(data.family.detail);
  const isOwner = $derived(data.viewer.kind === 'owner');
  /** Person pages this viewer may open, decided in the load. */
  const links = $derived<Record<string, string>>(data.links);

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
    if (m.notSharing || m.ageMins == null) return 'quiet';
    if (m.ageMins > STALE_MINS) return 'watch';
    return m.isHome ? 'good' : 'steady';
  }

  function memberValue(m: Member): string {
    if (m.notSharing) return 'off';
    if (m.ageMins == null) return '—';
    return m.isHome ? 'home' : 'out';
  }

  function memberSub(m: Member): string {
    if (m.notSharing && m.sharingUnknown) return 'Sharing unknown: the app’s sharing list could not be read.';
    if (m.notSharing) return 'Not sharing their location.';
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
      corner: m.today ? `${outFor(m.today.minutesOut)} out` : null,
      // The person's own page, where the load says this viewer may open it:
      // the owner anyone's, a household viewer only their own.
      href: links[m.subject] ?? null,
    })),
  );

  const notSharing = $derived(members.filter((m) => m.notSharing).length);
  const away = $derived(members.filter((m) => m.ageMins != null && m.isHome === false).length);
  const unknown = $derived(
    members.filter((m) => !m.notSharing && (m.ageMins == null || m.ageMins > STALE_MINS)).length,
  );
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
  standfirst={isOwner
    ? 'Read off the family trail — Life360 through Home Assistant, sampled every two minutes and kept ninety days — never asked for. What the nightly sweep has made of each person sits underneath.'
    : 'Where everyone who shares their location is now. Your own day is in full; everyone else’s is theirs.'}
  {summary}
  navBack={isOwner}
  footer={isOwner
    ? ['strangeramblings.com/home/people', 'Life360 via Home Assistant · 90-day trail', 'Owner-gated · the whole household, never shared']
    : ['strangeramblings.com/home/people', 'The household · live status only', 'Your day is shown to you and the owner']}
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
        {members.length} on the trail · {away} out · {unknown} without a fresh fix{#if notSharing}
          · {notSharing} not sharing{/if}. The figure in
        each corner is how long they have been away from home today{#if !isOwner}, shown on your own
          card only{/if}.
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
                <td class="cell-lead">
                  {#if links[m.subject]}
                    <a class="link" href={links[m.subject]}>{cap(m.subject)}</a>
                  {:else}
                    {cap(m.subject)}
                  {/if}
                </td>
                <td class="cell-wrap">
                  {#if m.notSharing && m.sharingUnknown}
                    sharing unknown
                  {:else if m.notSharing}
                    not sharing
                  {:else if m.ageMins == null}
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
                {#if m.today}
                  <td class="right num">{clock(m.today.firstOutMins)}</td>
                  <td class="right num">{outFor(m.today.minutesOut)}</td>
                  <td class="right num">{m.today.placesVisited}</td>
                  <td class="right num">{m.today.fixes}</td>
                {:else}
                  <td class="right num">—</td>
                  <td class="right num">—</td>
                  <td class="right num">—</td>
                  <td class="right num">—</td>
                {/if}
                <td class="right num" class:bad={m.batteryPct != null && m.batteryPct <= 25}>
                  {m.batteryPct == null ? '—' : `${m.batteryPct}%`}
                </td>
                <td class="right nowrap">{m.lastSeenAt ? stamp(m.lastSeenAt) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</section>

<!-- The sweep's findings are the owner's notes; a household viewer's load
     carries none, and the section is not drawn for them. -->
{#if isOwner}
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
{/if}

</HomeFrame>

<style>
  /* Room-specific only — `.band`, `.inner`, `.card`, `.tbl`, `.note`, `.lede`,
     `.link`, `.btn`, `.cta` all come from `.ds-vocab` (HomeFrame's DsVocab). */
  .today {
    margin-top: 22px;
  }
</style>
