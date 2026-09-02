<script lang="ts">
  // Every detector, ready or not, opening on the count of each state.
  //
  // The chips carried those counts already, but a chip row is a control and
  // reads as one: you have to decide to look at it. The deck above says the
  // same three numbers as a statement — how many can speak, how many are still
  // gathering history, how many you silenced — which is the answer to "why is
  // it quiet" that the table underneath then itemises.
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { DeckTile, Facet } from '$lib/components/jkai/daydream/hub/types';
  import { TONE_RANK, detectorTone } from '$lib/daydream/priority';

  interface Detector {
    kind: string;
    description: string;
    readiness: { ready: boolean; reason: string } | null;
    weight: number;
    useful: number;
    notUseful: number;
    relevance?: { mean: number; n: number } | null;
    muted: boolean;
  }

  interface Props {
    detectors: Detector[];
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { detectors, busy, act }: Props = $props();

  type DetState = 'all' | 'ready' | 'waiting' | 'muted';
  type DetOrder = 'priority' | 'name' | 'weight' | 'votes';
  let detState = $state<DetState>('all');
  let detOrder = $state<DetOrder>('priority');

  const readyCount = $derived(detectors.filter((d) => !d.muted && d.readiness?.ready).length);
  const waitingCount = $derived(detectors.filter((d) => !d.muted && !d.readiness?.ready).length);
  const mutedCount = $derived(detectors.filter((d) => d.muted).length);
  /** Detectors the ledger has an opinion about — a weight of exactly 1 means
   *  it has none, which is a different thing from a weight of 1.00 earned. */
  const learnedCount = $derived(detectors.filter((d) => d.weight !== 1).length);

  const stateTiles = $derived<DeckTile[]>([
    {
      key: 'ready',
      label: 'Ready to speak',
      value: String(readyCount),
      suffix: `/${detectors.length}`,
      tone: detectors.length && readyCount === detectors.length ? 'good' : 'watch',
      lit: readyCount > 0,
      sub: 'past the history floor each one declares',
    },
    {
      key: 'waiting',
      label: 'Still gathering',
      value: String(waitingCount),
      tone: waitingCount ? 'watch' : 'good',
      sub: waitingCount ? 'waiting on time, not on you' : 'nothing is short of history',
    },
    {
      key: 'muted',
      label: 'Muted by you',
      value: String(mutedCount),
      tone: mutedCount ? 'quiet' : 'steady',
      sub: mutedCount ? 'reversible — un-mute in the table' : 'nothing silenced',
    },
    {
      key: 'learned',
      label: 'Weighted by feedback',
      value: String(learnedCount),
      tone: learnedCount ? 'steady' : 'quiet',
      sub: 'the rest carry the neutral ×1.00',
    },
  ]);

  const detStateFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: detectors.length },
    { id: 'ready', label: 'Ready', count: readyCount },
    { id: 'waiting', label: 'Gathering', count: waitingCount },
    { id: 'muted', label: 'Muted', count: mutedCount },
  ]);

  const detOrderFacets = $derived<Facet[]>([
    { id: 'priority', label: 'Priority' },
    { id: 'name', label: 'Name' },
    { id: 'weight', label: 'Weight' },
    { id: 'votes', label: 'Votes' },
  ]);

  const detectorRows = $derived.by(() => {
    const rows = detectors.filter((d) => {
      if (detState === 'all') return true;
      if (detState === 'muted') return Boolean(d.muted);
      if (detState === 'ready') return !d.muted && Boolean(d.readiness?.ready);
      return !d.muted && !d.readiness?.ready;
    });
    const sorted = [...rows];
    if (detOrder === 'name') return sorted.sort((a, b) => a.kind.localeCompare(b.kind));
    if (detOrder === 'weight') return sorted.sort((a, b) => b.weight - a.weight);
    if (detOrder === 'votes') {
      return sorted.sort((a, b) => b.useful + b.notUseful - (a.useful + a.notUseful));
    }
    return sorted.sort(
      (a, b) =>
        TONE_RANK[detectorTone(a)] - TONE_RANK[detectorTone(b)] || a.kind.localeCompare(b.kind),
    );
  });
</script>

<StatDeck tiles={stateTiles} min={200} />

<div class="controls">
  <FacetBar label="State" active={detState} facets={detStateFacets} onpick={(id) => (detState = id as DetState)} />
  <FacetBar label="Order" active={detOrder} facets={detOrderFacets} onpick={(id) => (detOrder = id as DetOrder)} />
</div>

{#if detectorRows.length === 0}
  <div class="card t-quiet"><p class="card-body">No detector is in that state.</p></div>
{:else}
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr>
          <th>Detector</th>
          <th>What it looks for</th>
          <th>State</th>
          <th class="right">Weight</th>
          <th class="right">Votes</th>
          <th class="right">You said</th>
          <th class="right">Do</th>
        </tr>
      </thead>
      <tbody>
        {#each detectorRows as d (d.kind)}
          <tr class:dim={d.muted}>
            <td class="nowrap">{d.kind}</td>
            <td class="cell-lead cell-wrap">{d.description}</td>
            <td>
              <span class="pill t-{detectorTone(d)}">
                {d.muted ? 'muted' : d.readiness?.ready ? 'ready' : (d.readiness?.reason ?? 'not yet assessed')}
              </span>
            </td>
            <td class="right num" title="Learned multiplier from your feedback">×{d.weight.toFixed(2)}</td>
            <td class="right nowrap">{d.useful || d.notUseful ? `${d.useful}↑ ${d.notUseful}↓` : '—'}</td>
            <td class="right nowrap" title="Mean relevance you set, and how many you rated">
              {d.relevance ? `${d.relevance.mean.toFixed(1)} × ${d.relevance.n}` : '—'}
            </td>
            <td class="right">
              {#if d.muted}
                <button
                  type="button"
                  class="btn"
                  disabled={busy === `unmute:${d.kind}`}
                  onclick={() => act({ action: 'unmute_kind', kind: d.kind }, `unmute:${d.kind}`)}
                >
                  Un-mute
                </button>
              {:else}
                <span class="dim">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
