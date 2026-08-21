<script lang="ts">
  // The ground itself: the records across every stretch covered more than once,
  // what has been beaten lately, and the pairs taken back-to-back most often.
  //
  // Lifted out of the old GroundDashboard, plus the chains the segments
  // explorer already computes — the hub had no reason to know less about the
  // ground than its own sub-page did.
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import { formatDuration, formatElevation, formatPace } from '$lib/trails/format';
  import type { SegmentHighlights } from '$lib/trails/segments-service';
  import type { SegmentChain } from '$lib/trails/highlights-service';

  let {
    segments,
    chains = [],
    onevidence,
  }: {
    segments: SegmentHighlights | null;
    chains?: SegmentChain[];
    onevidence?: (id: string) => void;
  } = $props();

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The PR's day is the phone's own local day, not the server's UTC one — a
  // half-past-midnight BST effort belongs to the evening it was lived.
  function prDay(startDateLocal: string): string {
    const day = startDateLocal.slice(0, 10);
    const dt = new Date(Date.parse(day + 'T00:00:00Z'));
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  }

  const hasChains = $derived(chains.length > 0);
</script>

{#if segments && segments.totals.segments > 0}
  <dl class="records cellgrid">
    {#if segments.records.fastestPace}
      <div>
        <dt>Fastest pace</dt>
        <dd>{formatPace(segments.records.fastestPace.value)}</dd>
        <a class="rec-seg" href="/health/segments/{segments.records.fastestPace.segmentId}">
          {segments.records.fastestPace.name}
        </a>
      </div>
    {/if}
    {#if segments.records.bestEfficiency}
      <div>
        <dt>Best efficiency</dt>
        <dd>{segments.records.bestEfficiency.value.toFixed(2)}</dd>
        <a class="rec-seg" href="/health/segments/{segments.records.bestEfficiency.segmentId}">
          {segments.records.bestEfficiency.name}
        </a>
      </div>
    {/if}
    {#if segments.records.lowestCost}
      <div>
        <dt>Lowest cost</dt>
        <dd>{Math.round(segments.records.lowestCost.value)} b/km</dd>
        <a class="rec-seg" href="/health/segments/{segments.records.lowestCost.segmentId}">
          {segments.records.lowestCost.name}
        </a>
      </div>
    {/if}
    {#if segments.records.biggestClimb}
      <div>
        <dt>Biggest climb</dt>
        <dd>+{formatElevation(segments.records.biggestClimb.value)}</dd>
        <a class="rec-seg" href="/health/segments/{segments.records.biggestClimb.segmentId}">
          {segments.records.biggestClimb.name}
        </a>
      </div>
    {/if}
  </dl>

  <div class="split">
    {#if segments.recentPrs.length > 0}
      <div class="col">
        <span class="sr-label-tight">New bests — last 30 days</span>
        <ul class="pr-list">
          {#each segments.recentPrs as pr (`${pr.segmentId}:${pr.metric}`)}
            <li>
              <span class="pr-date">{prDay(pr.startDateLocal)}</span>
              <a class="pr-name" href="/health/segments/{pr.segmentId}">{pr.name}</a>
              <span class="pr-what">
                {pr.metric === 'time'
                  ? `fastest ever — ${formatDuration(pr.value)}`
                  : `most efficient ever — ${pr.value.toFixed(2)}`}
                <span class="pr-of">of {pr.effortCount} efforts</span>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if hasChains}
      <div class="col">
        <span class="sr-label-tight">Chained most often</span>
        <ul class="pr-list">
          {#each chains.slice(0, 5) as chain (chain.key)}
            <li>
              <span class="pr-date">{chain.occurrences}×</span>
              <span class="pr-name">
                <a href="/health/segments/{chain.firstSegmentId}">{chain.firstName}</a>
                <span class="arrow" aria-hidden="true">→</span>
                {#if chain.secondSegmentId > 0}
                  <a href="/health/segments/{chain.secondSegmentId}">{chain.secondName}</a>
                {:else}{chain.secondName}{/if}
              </span>
              <span class="pr-what">
                best {formatDuration(chain.bestElapsedS)}
                <span class="pr-of">start of the first to the end of the second</span>
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  <nav class="seg-links">
    <a href="/health/segments">All {segments.totals.segments} segments</a>
    <a href="/health/segments?sort=gettable">Closest to a PB</a>
    <a href="/health/segments?form=improving">Improving</a>
    <a href="/health/segments?sort=climb">Biggest climbs</a>
    <a href="/health/segments?offroad=1">Offroad</a>
    <EvidenceChip id="efficiency-factor" onopen={onevidence} />
  </nav>
{/if}

<style>
  .records {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0 0 1.5rem 0;
  }
  @media (max-width: 900px) {
    .records {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .records div {
    min-width: 0;
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .records dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .records dd {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    margin: 0;
    line-height: 1.1;
  }
  .rec-seg {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rec-seg:hover {
    text-decoration: underline;
  }

  .split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.5rem 2rem;
  }
  .col {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .pr-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .pr-list li {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr);
    gap: 0.25rem 0.75rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .pr-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .pr-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    text-decoration: none;
    min-width: 0;
  }
  .pr-name a {
    color: var(--accent);
    text-decoration: none;
  }
  .pr-name a:hover,
  a.pr-name:hover {
    text-decoration: underline;
  }
  .arrow {
    color: var(--text-ghost);
    margin: 0 0.2rem;
  }
  .pr-what {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .pr-of {
    color: var(--text-ghost);
    margin-left: 0.35rem;
  }

  .seg-links {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    margin-top: 1.5rem;
  }
  .seg-links a {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
  }
  .seg-links a:hover {
    text-decoration: underline;
  }
</style>
