<script lang="ts">
  /**
   * The capture feed — the emotional centre, and the reason this is a game for
   * five people rather than a dashboard for one.
   *
   * Every line is a sentence about somebody taking ground off somebody else,
   * built from geo_claims.tiles_taken. 'unclaimed' is virgin ground and gets a
   * different verb: taking open ground is not the same event as taking
   * Katie's, and reading them in the same words would flatten the only thing
   * anyone here cares about.
   */
  import { activityLabel, km2, relativeAge, UNCLAIMED } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { FeedItem } from './types';

  let {
    feed,
    players,
    now,
  }: { feed: FeedItem[]; players: PlayerIdentity[]; now: number } = $props();

  const byId = $derived(new Map(players.map((p) => [p.subject, p])));
</script>

<section class="feed" aria-label="Capture feed">
  <header class="feed-hd">
    <span class="metric-label">Capture feed</span>
    <span class="metric-label muted">{feed.length} claims</span>
  </header>

  {#if feed.length === 0}
    <p class="feed-empty">
      No closed loops yet. Ground still changes hands on trample alone — walk a
      block and come back round to make a claim.
    </p>
  {:else}
    <ol class="feed-list">
      {#each feed as item (item.id)}
        {@const who = byId.get(item.subject)}
        {@const stolen = item.victims.filter((v) => v.subject !== UNCLAIMED)}
        {@const open = item.victims.find((v) => v.subject === UNCLAIMED)}
        <li class="feed-row" style="--who: {who?.colour ?? 'var(--text-primary)'}">
          <span class="feed-badge" aria-hidden="true">{who?.initial ?? '?'}</span>
          <div class="feed-body">
            <p class="feed-line">
              <span class="feed-actor">{who?.name ?? item.subject}</span>
              {#if stolen.length}
                <span class="feed-verb">took</span>
                <span class="feed-area">{km2(stolen.reduce((n, v) => n + v.areaM2, 0))} km²</span>
                <span class="feed-verb">off</span>
                {#each stolen as v, i (v.subject)}
                  {@const victim = byId.get(v.subject)}
                  <span class="feed-victim" style="--vic: {victim?.colour ?? 'var(--text-muted)'}"
                    >{victim?.name ?? v.subject}</span
                  >{#if i < stolen.length - 1}<span class="feed-verb">and</span>{/if}
                {/each}
              {:else}
                <span class="feed-verb">claimed</span>
                <span class="feed-area">{km2(item.areaM2)} km²</span>
                <span class="feed-verb">of open ground</span>
              {/if}
            </p>
            <p class="feed-meta">
              <span>{activityLabel(item.activityType)}</span>
              <span aria-hidden="true">/</span>
              <span>{item.method === 'self_intersection' ? 'crossed its own path' : 'closed loop'}</span>
              {#if item.pathM}
                <span aria-hidden="true">/</span>
                <span>{(item.pathM / 1000).toFixed(1)} km walked</span>
              {/if}
              {#if stolen.length && open}
                <span aria-hidden="true">/</span>
                <span>+{km2(open.areaM2)} km² open</span>
              {/if}
            </p>
          </div>
          <time class="feed-when" datetime={item.at}>{relativeAge(item.at, now)}</time>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .feed {
    border: 1px solid var(--line-strong);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .feed-hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .feed-empty {
    margin: 0;
    padding: 18px 16px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 46ch;
  }
  .feed-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    max-height: 60vh;
  }
  .feed-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 12px 16px 12px 13px;
    border-bottom: 1px solid var(--line-hair);
    border-left: 3px solid var(--who);
  }
  .feed-row:last-child {
    border-bottom: 0;
  }
  .feed-badge {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--fs-label);
    line-height: 30px;
    text-align: center;
    height: 30px;
    color: var(--bg);
    background: var(--who);
    border-radius: var(--radius-sharp);
  }
  .feed-body {
    min-width: 0;
  }
  .feed-line {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    line-height: 1.35;
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .feed-actor {
    color: var(--who);
  }
  .feed-verb {
    font-family: var(--font-mono);
    font-weight: 500;
    color: var(--text-ghost);
    letter-spacing: var(--tracking-label);
  }
  .feed-area {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .feed-victim {
    color: var(--vic);
  }
  .feed-meta {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .feed-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
    padding-top: 2px;
  }
  @media (max-width: 640px) {
    .feed-row {
      grid-template-columns: 26px minmax(0, 1fr);
    }
    .feed-badge {
      height: 26px;
      line-height: 26px;
    }
    .feed-when {
      grid-column: 2;
      padding-top: 0;
    }
  }
</style>
