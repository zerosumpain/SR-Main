<script lang="ts">
  // 03 — CHAINS. Two stretches taken one straight after the other.
  //
  // A chain is a third piece of ground: the transition between two segments is
  // the part that actually improves, and it belongs to neither of them. Timed
  // from the start of the first to the end of the second — so the transition is
  // inside the clock — and a gap of more than two minutes is not a chain.
  //
  // The dashboard's section F names the single most-taken pair. This is the
  // whole list, which is a superset rather than a second opinion: same query,
  // same numbers, more rows.
  //
  // Row shape and name treatment are ActivitySegments': mono identifiers with
  // the dots in accent, figures right-aligned, hover a background tint.
  import { formatDuration } from '$lib/trails/format';
  import { shortDay } from './format';
  import type { SegmentChain } from '$lib/trails/highlights-service';

  interface Props {
    chains: SegmentChain[];
  }

  let { chains }: Props = $props();

  /** `YYYY-MM-DD` from unix seconds, for `shortDay` — which never sees a Date. */
  function day(at: number): string {
    return new Date(at * 1000).toISOString().slice(0, 10);
  }
</script>

{#if chains.length}
  <section class="sc">
    <div class="sc-inner">
      <div class="sc-head">
        <p class="sc-kicker">Chains · taken back to back</p>
        <p class="sc-meta">{chains.length} pair{chains.length === 1 ? '' : 's'}</p>
      </div>

      <div class="sc-rows">
        {#each chains as chain (chain.key)}
          <div class="sc-row">
            <span class="sc-names">
              <a class="sc-name" href="/health/segments/{chain.firstSegmentId}"
                >{#each chain.firstName.split('.') as part, i (i)}{#if i > 0}<span class="sc-dot"
                      >.</span
                    >{/if}{part}{/each}</a
              >
              <span class="sc-arrow" aria-hidden="true">→</span>
              {#if chain.secondSegmentId > 0}
                <a class="sc-name" href="/health/segments/{chain.secondSegmentId}"
                  >{#each chain.secondName.split('.') as part, i (i)}{#if i > 0}<span class="sc-dot"
                        >.</span
                      >{/if}{part}{/each}</a
                >
              {:else}
                <span class="sc-name">{chain.secondName}</span>
              {/if}
            </span>

            <span class="sc-nums">
              <span class="sc-time">{formatDuration(chain.bestElapsedS)}</span>
              <span class="sc-sub">{chain.occurrences}× · last {shortDay(day(chain.lastAt))}</span>
            </span>
          </div>
        {/each}
      </div>

      <p class="sc-rule">
        Timed from the start of the first to the end of the second, so the transition between them
        counts — that is the part you actually get better at. A gap of more than two minutes is not
        a chain.
      </p>
    </div>
  </section>
{/if}

<style>
  .sc {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-top: 2px solid var(--line);
  }
  .sc-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  .sc-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .sc-kicker,
  .sc-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .sc-kicker {
    font-weight: 500;
  }
  .sc-meta {
    color: var(--text-muted);
  }

  .sc-rows {
    display: flex;
    flex-direction: column;
  }
  .sc-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 13px 4px;
    border-bottom: 1px solid var(--line);
    /* Hover is colour only — no lift, no fade, no scale. */
    transition: background-color 0.2s ease-out;
  }
  .sc-row:hover {
    background: rgba(26, 16, 8, 0.05);
  }

  .sc-names {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .sc-name {
    font-family: var(--font-brand);
    font-size: var(--fs-body-sm);
    font-weight: 500;
    letter-spacing: -0.01em;
    text-transform: lowercase;
    color: var(--text-primary);
    text-decoration: none;
    overflow-wrap: anywhere;
    transition: color 0.2s ease-out;
  }
  a.sc-name:hover {
    color: var(--accent);
  }
  .sc-dot {
    color: var(--accent);
  }
  .sc-arrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }

  .sc-nums {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    text-align: right;
  }
  .sc-time {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-weight: 500;
  }
  .sc-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sc-rule {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    max-width: 92ch;
    margin: 18px 0 0;
  }

  @media (max-width: 560px) {
    .sc-row {
      grid-template-columns: minmax(0, 1fr);
    }
    .sc-nums {
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
