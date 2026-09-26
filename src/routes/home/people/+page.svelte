<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  /**
   * The household room — /home/people. Read off the trail, never asked for:
   * where everyone is now. One band — the owner's links, the map, one card per
   * person — under the hero's three counts.
   *
   * The daydream sweep's per-person findings used to fill 80% of this page;
   * the engine is gone (#970) and so are they. Each person's history is on
   * their own page, /home/people/[subject].
   *
   * Two viewers: the owner, and a household member signed in with the
   * 'household' role. What each receives is decided in the load
   * (`scopeHousehold`), not here — for a household viewer another person's
   * `today` is null and a person not sharing carries no position at all. This
   * page only has to draw those gaps honestly.
   */
  import type { PageData } from './$types';
  import type { Tone } from '$lib/daydream/priority';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import CircleMap from '$lib/components/home/CircleMap.svelte';
  import { feedCheckText, nowCounts, nowLabel, nowStatus, nowSub, type NowStatus } from '$lib/home/presence/now';

  let { data }: { data: PageData } = $props();

  let clock = $state<Date | null>(null);
  const now = $derived(clock ?? new Date(data.loadedAt));
  const members = $derived(data.family.members.map((m) => ({
    ...m,
    ageMins: m.lastSeenAt ? Math.max(0, Math.round((now.getTime() - new Date(m.lastSeenAt).getTime()) / 60_000)) : null,
  })));
  const isOwner = $derived(data.viewer.kind === 'owner');
  /** Person pages this viewer may open, decided in the load. */
  const links = $derived<Record<string, string>>(data.links);

  onMount(() => {
    clock = new Date();
    const clockTimer = setInterval(() => { clock = new Date(); }, 1_000);
    let refreshing = false;
    const refresh = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try { await invalidate('home:people'); }
      catch { /* Keep the last successful read and its original timestamps. */ }
      finally { refreshing = false; }
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      clearInterval(clockTimer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  function cap(sub: string): string {
    return sub.charAt(0).toUpperCase() + sub.slice(1);
  }

  function outFor(mins: number): string {
    if (mins >= 60) return `${Math.round(mins / 6) / 10}h`;
    return `${mins}m`;
  }

  /**
   * The exact time of the last fix, for the card's tooltip. Pinned to
   * Europe/London because the server runs UTC and a 00:40 BST fix would
   * otherwise be filed a day early.
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

  type Member = PageData['family']['members'][number];

  const TONE: Record<NowStatus, Tone> = { home: 'good', out: 'steady', unknown: 'watch', off: 'quiet' };

  function stampOf(m: Member): string | null {
    if (!m.lastSeenAt) return null;
    const bits = [`Last fix ${STAMP_FMT.format(new Date(m.lastSeenAt))}`];
    if (m.batteryPct != null) bits.push(`battery ${m.batteryPct}%`);
    return bits.join(' · ');
  }

  const cells = $derived<RollupCell[]>(
    members.map((m) => {
      const status = nowStatus(m);
      return {
        key: m.subject,
        label: cap(m.subject),
        value: nowLabel(m),
        sub: nowSub(m),
        detail: m.notSharing ? null : feedCheckText(data.feedChecks[m.subject], now),
        tone: status === 'unknown' && m.ageMins != null ? 'steady' : TONE[status],
        corner: m.today && m.today.minutesOut > 0 ? `${outFor(m.today.minutesOut)} out` : null,
        // The person's own page, where the load says this viewer may open it:
        // the owner anyone's, a household viewer their own and their wards'.
        href: links[m.subject] ?? null,
        title: stampOf(m),
      };
    }),
  );

  const counts = $derived(nowCounts(members));
  const noLocation = $derived(members.filter((m) => !m.notSharing && m.ageMins == null).length);
  const summary = $derived([
    { label: 'Home', value: String(counts.home), sub: `of ${counts.sharing} sharing` },
    { label: 'Out', value: String(counts.out), sub: 'recent location' },
    { label: 'Last known', value: String(counts.unknown - noLocation), sub: 'earlier location' },
    { label: 'No location', value: String(noLocation), sub: 'none received' },
  ]);
</script>

<HomeFrame
  path="/home/people"
  kicker="Home · People"
  title={['Where everyone', 'is, and was']}
  standfirst={isOwner
    ? 'The family’s latest locations — app uploads checked every 30 seconds, Life360 through Home Assistant every two minutes, kept ninety days.'
    : 'Where everyone who shares their location is now; your own day is on your own page.'}
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
      kicker="A / Now"
      title={['Everyone,', 'right now']}
      strap="Feed checks and location times are shown separately. An older location stays labelled last known; a feed check alone does not confirm that the phone is still there."
    />

    {#if isOwner}
      <!-- Owner-only settings. Neither route is a household route, so the hook
           refuses anyone else; the links are drawn for the owner only. -->
      <p class="actions owner-links">
        <a class="btn sm" href="/home/people/places">Places and alerts</a>
        <a class="btn sm" href="/home/people/settings">Household settings</a>
      </p>
    {/if}

    {#if data.positions.length}
      <div class="now-map">
        <CircleMap positions={data.positions.map((p) => ({ ...p, label: cap(p.subject) }))} />
      </div>
    {/if}

    {#if !members.length}
      <p class="lede">Nobody is on the trail.</p>
    {:else}
      <div class="now-cards">
        <RollupGrid {cells} min={210} />
      </div>
    {/if}
  </div>
</section>

</HomeFrame>

<style>
  /* Room-specific only — `.band`, `.inner`, `.lede`, `.btn` come from
     `.ds-vocab` (HomeFrame's DsVocab). */
  .owner-links {
    margin: 0 0 18px;
  }
  .now-map {
    margin-bottom: 18px;
  }

  .now-cards :global(.rg-sub) {
    display: block;
    overflow: visible;
  }

  /* Below 720px each card is one list row — name and status on a line, the
     sub under it — instead of a 118px tile per person. RollupGrid is shared,
     so the row shape is asked for here, under this page's wrapper only. */
  @media (max-width: 720px) {
    .now-cards :global(.rg) {
      grid-template-columns: minmax(0, 1fr);
      grid-auto-rows: auto;
      gap: 6px;
    }
    .now-cards :global(.rg-cell) {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'top value'
        'sub sub'
        'detail detail';
      align-items: baseline;
      gap: 2px 12px;
      min-height: 0;
      padding: 9px 14px 9px;
      border-top: 1px solid var(--card-border);
      border-left: 3px solid var(--tone);
    }
    .now-cards :global(.rg-top) {
      grid-area: top;
    }
    .now-cards :global(.rg-value) {
      grid-area: value;
      font-size: 18px;
    }
    .now-cards :global(.rg-sub) {
      grid-area: sub;
    }
    .now-cards :global(.rg-detail) {
      grid-area: detail;
    }
  }
</style>
