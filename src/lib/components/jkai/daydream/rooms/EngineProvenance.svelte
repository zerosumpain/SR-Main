<script lang="ts">
  // Does the thing you think is feeding the reasoning actually feed it?
  //
  // The measurement was a stack of cards, each with its own table, and the
  // count that matters — how many of a source's paths are actually carrying
  // anything — had to be read off row by row. So each source gets an even cell
  // first, wearing the tone of its WORST link: a source with four flowing
  // paths and one broken one is not a healthy source.
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import { TONE_RANK, provenanceTone } from '$lib/daydream/priority';

  interface Link {
    to: string;
    state: string;
    detail: string;
  }

  interface Source {
    key: string;
    label: string;
    blurb: string;
    summary: string;
    links: Link[];
  }

  interface Props {
    sources: Source[];
  }

  let { sources }: Props = $props();

  /** `by_design` reads as "not wired" everywhere it is shown: a path somebody
   *  chose to close, said in words rather than in a slug. */
  function stateLabel(state: string): string {
    return state === 'by_design' ? 'not wired' : state;
  }

  const cells = $derived<RollupCell[]>(
    sources.map((s) => {
      const flowing = s.links.filter((l) => l.state === 'flowing').length;
      const worst = s.links.reduce<string>(
        (acc, l) => (TONE_RANK[provenanceTone(l.state)] < TONE_RANK[provenanceTone(acc)] ? l.state : acc),
        s.links[0]?.state ?? 'flowing',
      );
      return {
        key: s.key,
        label: s.label,
        value: String(flowing),
        suffix: `/${s.links.length}`,
        tone: s.links.length ? provenanceTone(worst) : 'quiet',
        sub: s.summary,
      };
    }),
  );
</script>

{#if sources.length === 0}
  <div class="card t-quiet"><p class="card-body">Nothing measured yet.</p></div>
{:else}
  <RollupGrid {cells} min={200} />

  <div class="stack srcs">
    {#each sources as src (src.key)}
      <div class="card t-steady">
        <div class="card-hd">
          <p class="card-title as-text">{src.label}</p>
          <span class="pill t-steady">{src.summary}</span>
        </div>
        <p class="card-body">{src.blurb}</p>
        <div class="tbl-wrap">
          <table class="tbl compact">
            <thead><tr><th>State</th><th>Reaches</th><th>Measurement</th></tr></thead>
            <tbody>
              {#each src.links as l, li (li)}
                <tr>
                  <td class="nowrap">
                    <span class="pill t-{provenanceTone(l.state)}">{stateLabel(l.state)}</span>
                  </td>
                  <td class="cell-lead">{l.to}</td>
                  <td class="cell-wrap">{l.detail}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .srcs {
    margin-top: 20px;
  }
  /* Not in the shared vocabulary — a card head that sets a title against its
     headline measurement. */
  .card-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
</style>
