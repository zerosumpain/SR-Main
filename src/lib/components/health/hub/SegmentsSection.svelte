<script lang="ts">
  // F — SEGMENTS. Which of your own records are actually gettable.
  //
  // A leaderboard says what your best ever was. Form says whether you are
  // gaining on that ground. Gettable is where the two agree, and the four tiles
  // are the whole corpus sorted by that question rather than by name.
  //
  // `segmentForm` is median-based with a ±2% holding band and a six-effort
  // floor, so most of a several-hundred-segment corpus sits permanently in NO
  // FORM READ. That is not a gap in the data; it is the honest answer for
  // ground covered twice.
  import type { SegmentChain } from '$lib/trails/highlights-service';
  import SectionHead from './SectionHead.svelte';
  import type { SegmentForms } from './types';
  import { duration, shortDate } from './format';

  interface Props {
    segmentForms: SegmentForms | null;
    totals: { segments: number; efforts: number } | null;
    chains: SegmentChain[];
  }

  let { segmentForms, totals, chains }: Props = $props();

  const corpus = $derived(totals?.segments ?? segmentForms?.taxonomy.total ?? 0);
  const kicker = $derived(
    totals
      ? `F / Segments · ${totals.segments} in the corpus · ${totals.efforts} efforts`
      : 'F / Segments',
  );

  interface Tile {
    label: string;
    count: number | null;
    tone: 'good' | 'plain' | 'accent' | 'ghost';
    note: string;
  }

  const tiles = $derived.by((): Tile[] => {
    const t = segmentForms?.taxonomy ?? null;
    return [
      {
        label: 'Improving',
        count: t?.improving ?? null,
        tone: 'good',
        note: 'Recent median quicker than the earlier window by more than 2%.',
      },
      {
        label: 'Holding',
        count: t?.holding ?? null,
        tone: 'plain',
        note: 'Inside the ±2% noise band. Neither gaining nor losing ground.',
      },
      {
        label: 'Slipping',
        count: t?.slipping ?? null,
        tone: 'accent',
        note: 'Slower by more than 2%. Expected across the board once weekly volume drops.',
      },
      {
        label: 'No form read',
        count: t?.noRead ?? null,
        tone: 'ghost',
        note: `Under six efforts. Most of a ${corpus}-segment corpus will sit here permanently.`,
      },
    ];
  });

  const board = $derived(segmentForms?.board ?? []);
  const topChain = $derived(chains[0] ?? null);
</script>

<section class="f">
  <div class="f-inner">
    <SectionHead
      {kicker}
      title={['Which records', 'are actually gettable']}
      strap="A leaderboard says what your best ever was. Form says whether you're gaining on that ground. Gettable is where the two agree: improving, and inside 3% of the record."
    />

    <div class="f-tiles">
      {#each tiles as tile (tile.label)}
        <div class="f-tile">
          <p class="f-tile-label">{tile.label}</p>
          <p class="f-tile-value tone-{tile.tone}">
            {#if tile.count == null}
              — <span class="f-tile-await">awaiting feed</span>
            {:else}
              {tile.count}
            {/if}
          </p>
          <p class="f-tile-note">{tile.note}</p>
        </div>
      {/each}
    </div>

    <div class="f-cols">
      <div class="f-board">
        <p class="f-board-label">The gettable board</p>
        <p class="f-board-lede">
          Ranked by one composite instead of by name:
          <span class="f-strong">improving direction, gap under 3%, an old PB, six or more efforts.</span>
          {#if board.length}
            That is {board.length} segment{board.length === 1 ? '' : 's'} where a PB is a realistic
            afternoon rather than a fantasy — and it is exactly the list that makes the hard-effort
            move measurable.
          {:else}
            Nothing clears all four today, which is the honest answer rather than an empty list
            dressed up as a target.
          {/if}
        </p>

        <div class="f-defs">
          <div class="f-def">
            <p class="f-def-label">Direction</p>
            <p class="f-def-text">Median-based, so one effort spent waiting at a gate doesn't read as collapse.</p>
          </div>
          <div class="f-def">
            <p class="f-def-label">Gap</p>
            <p class="f-def-text">Best of the last three against the all-time best, as a percentage.</p>
          </div>
          <div class="f-def last">
            <p class="f-def-label">Staleness</p>
            <p class="f-def-text">Days from PB to now — an old record on ground you still cover is the catchable kind.</p>
          </div>
        </div>

        {#if board.length}
          <div class="f-list">
            <p class="f-list-label">In range now</p>
            {#each board.slice(0, 5) as row (row.id)}
              <a class="f-row" href="/health/segments/{row.id}">
                <span class="f-row-name">{row.name}</span>
                <span class="f-row-meta">
                  gap {row.gapPct.toFixed(1)}%{#if row.daysSincePb != null} · pb {row.daysSincePb}d{/if} ·
                  {row.effortCount} efforts
                </span>
              </a>
            {/each}
          </div>
        {/if}
      </div>

      <div class="f-chains">
        <p class="f-chains-label">Chains · the under-used one</p>
        <p class="f-chains-text">
          The site already finds ordered segment pairs taken back-to-back, ranked by how often. Two
          stretches run one after the other are a third thing, and the transition between them is the
          part that actually improves.
        </p>
        <p class="f-chains-text">
          A chain you take every week deserves a target time far more than a segment you've run
          twice — and a chain PB is a harder, more interesting objective than either half.
        </p>

        <div class="f-chain-tile">
          <p class="f-def-label">Most-taken chain</p>
          {#if topChain}
            <p class="f-chain-name">{topChain.firstName} → {topChain.secondName}</p>
            <p class="f-chain-meta">
              {topChain.occurrences} times · best {duration(topChain.bestElapsedS)} · last {shortDate(
                new Date(topChain.lastAt * 1000).toISOString().slice(0, 10),
              )}
            </p>
          {:else}
            <p class="f-chain-meta">No pair has been taken back-to-back often enough to rank yet.</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .f {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .f-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .f-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 14px;
    margin-bottom: clamp(24px, 3vw, 36px);
  }
  .f-tile {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 20px;
    min-width: 0;
  }
  .f-tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 10px;
  }
  .f-tile-value {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .f-tile-value.tone-good {
    color: var(--good);
  }
  .f-tile-value.tone-accent {
    color: var(--accent);
  }
  .f-tile-value.tone-ghost {
    color: rgba(26, 16, 8, 0.35);
  }
  .f-tile-await {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: rgba(26, 16, 8, 0.4);
  }
  .f-tile-note {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    margin: 10px 0 0;
    text-wrap: pretty;
  }

  .f-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(20px, 2.5vw, 36px);
  }

  .f-board {
    border: 2px solid rgba(196, 87, 10, 0.35);
    background: rgba(196, 87, 10, 0.07);
    padding: clamp(20px, 2.5vw, 30px);
    min-width: 0;
  }
  .f-board-label,
  .f-chains-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0 0 16px;
  }
  .f-board-label {
    color: var(--accent);
  }
  .f-chains-label {
    color: var(--text-ghost);
  }
  .f-board-lede,
  .f-chains-text {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: rgba(26, 16, 8, 0.8);
    margin: 0 0 20px;
    text-wrap: pretty;
  }
  .f-strong {
    font-weight: 500;
  }

  .f-defs {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .f-def {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(26, 16, 8, 0.14);
  }
  .f-def.last {
    padding-bottom: 0;
    border-bottom: none;
  }
  .f-def-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    width: 92px;
    flex-shrink: 0;
    margin: 0;
  }
  .f-def-text {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: rgba(26, 16, 8, 0.75);
    margin: 0;
  }

  .f-list {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid rgba(26, 16, 8, 0.14);
  }
  .f-list-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 10px;
  }
  .f-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    padding: 8px 0;
    border-bottom: 1px solid rgba(26, 16, 8, 0.08);
    text-decoration: none;
    color: inherit;
    transition: background-color 0.2s ease-out;
  }
  .f-row:hover {
    background: rgba(26, 16, 8, 0.05);
  }
  .f-row-name {
    font-family: var(--font-brand);
    font-size: var(--fs-nav);
    font-weight: 500;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    min-width: 0;
    word-break: break-word;
  }
  .f-row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .f-chains {
    border: 1px solid var(--card-border);
    padding: clamp(20px, 2.5vw, 30px);
    min-width: 0;
  }
  .f-chain-tile {
    border-top: 1px solid rgba(26, 16, 8, 0.14);
    padding-top: 16px;
  }
  .f-chain-name {
    font-family: var(--font-brand);
    font-size: var(--fs-body-sm);
    font-weight: 500;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    margin: 8px 0 6px;
    word-break: break-word;
  }
  .f-chain-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }

  @media (max-width: 860px) {
    .f-cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
