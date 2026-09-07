<script lang="ts">
  // /releases — one document, two depths.
  //
  //   A  The record      how much has shipped, and what the queue looks like
  //   B  Cadence         how often it ships, and what those deploys carry
  //   C  The log         every entry, as deep as the reader is allowed to go
  //
  // Signed out, C is the capability record: the publicly-describable things
  // that went live, grouped by day, complete and indexable. Signed in, C is the
  // console that used to live at /admin/ops/releases — the version log with
  // commits, files, evidence and the summariser controls.
  //
  // The loader has already built one payload or the other; this component
  // chooses a view over what it was given and never a filter on top of it.
  // `{#if owner}` in a template still ships the bytes to the browser, which is
  // the whole reason the split lives upstream — see the loader's note, and
  // $lib/releases/public-filter for what a release summary can accidentally
  // quote.
  //
  // Band rhythm follows /health: measurement is dark, the record is light. B
  // stays on paper because its mark uses petrol (`--accent-ink`), which is a
  // PAPER counter-accent with no role on an ink ground.
  import { invalidateAll } from '$app/navigation';
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';
  import ReleaseMasthead from './ReleaseMasthead.svelte';
  import ReleaseCadence from './ReleaseCadence.svelte';
  import ReleaseFilters from './ReleaseFilters.svelte';
  import CapabilityRecord from './CapabilityRecord.svelte';
  import VersionLog from './VersionLog.svelte';
  import type { ReleasesData, Tile } from './types';

  let { data }: { data: ReleasesData } = $props();

  const owner = $derived(data.mode === 'owner');

  function fmt(n: number): string {
    return n.toLocaleString('en-GB');
  }

  // ——— the summariser, owned here so the batch buttons in A and the
  // per-release Regenerate in C share one in-flight flag ————————————
  let busy = $state(false);
  let busyMsg = $state<string | null>(null);

  // A plain `let`, never `$state`: nothing reactive reads it, and a timer
  // handle a function both reads and writes is the documented read-own-write
  // loop that ends in `effect_update_depth_exceeded`.
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  async function summarise(body: Record<string, unknown>, label: string) {
    busy = true;
    busyMsg = label;
    try {
      const res = await fetch('/api/releases/summarise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.message || `HTTP ${res.status}`);
      busyMsg = result.remaining ? `${result.remaining} still pending` : 'done';
      await invalidateAll();
    } catch (err) {
      busyMsg = err instanceof Error ? err.message : 'failed';
    } finally {
      busy = false;
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => (busyMsg = null), 4000);
    }
  }

  // ——— A ————————————————————————————————————————————————————————————
  const tiles = $derived.by((): Tile[] => {
    if (data.mode === 'owner') {
      const t = data.totals;
      return [
        { label: 'Releases', value: fmt(t.releases), note: 'in this view' },
        { label: 'Commits', value: fmt(t.commits) },
        { label: 'File changes', value: fmt(t.files) },
        { label: 'Lines', value: `+${fmt(t.insertions)}`, note: `−${fmt(t.deletions)} removed` },
        { label: 'Range', value: t.minDate ?? '—', note: `to ${t.maxDate ?? '—'}` },
      ];
    }
    const t = data.totals;
    return [
      { label: 'Releases', value: fmt(t.releases), note: `over ${fmt(t.days)} days` },
      { label: 'Shipped', value: fmt(t.shipped), note: 'described here' },
      { label: 'Commits', value: fmt(t.commits) },
      { label: 'Lines added', value: fmt(t.insertions) },
      { label: 'Files touched', value: fmt(t.files) },
    ];
  });

  const mastheadKicker = $derived(
    data.mode === 'owner'
      ? `A / The record · full read · ${fmt(data.totals.releases)} releases`
      : `A / The record · ${fmt(data.totals.releases)} releases`,
  );

  const mastheadStrap = $derived(
    data.mode === 'owner'
      ? 'Every production deploy, and what each one put live. Generated from the deployed commit range — independent of how the work was built.'
      : 'Every production deploy of this site, summarised into the distinct things it put live. Generated from the deployed commit range, not written by hand.',
  );

  // ——— B ————————————————————————————————————————————————————————————
  const kindMix = $derived(data.mode === 'owner' ? data.kindDist : data.kindMix);

  const cadenceStrap = $derived(
    data.mode === 'owner'
      ? 'Deploys per week against the entries they carried, over the last weeks in this view. Both series are counts on one scale.'
      : 'Deploys per week against the capabilities they carried. Deploy counts are the whole record; the lower series counts only what this page can describe.',
  );

  // ——— C ————————————————————————————————————————————————————————————
  const logKicker = $derived(
    data.mode === 'owner'
      ? `C / Version log · page ${data.filters.page + 1}`
      : `C / What shipped · ${fmt(data.items.length)} entries`,
  );

  const result = $derived(
    data.mode === 'owner'
      ? `${fmt(data.totals.releases)} releases matched`
      : `${fmt(data.items.length)} entries matched`,
  );

  const footer = $derived(
    data.mode === 'owner'
      ? [
          'strangeramblings.com/releases · full read · commits, files and evidence',
          `${fmt(data.totals.pending)} pending · ${fmt(data.totals.failed)} failed`,
          'Owner view — this is the whole log, unfiltered',
        ]
      : [
          'strangeramblings.com/releases · public read',
          `${fmt(data.totals.releases)} releases · ${fmt(data.totals.shipped)} described`,
          'Generated from the deployed commit range',
        ],
  );

  const note = $derived(
    owner
      ? null
      : 'Internal infrastructure work, and anything touching a private project, is recorded but not listed here. Most of these releases were reconstructed from git history, so their timestamps are approximate.',
  );
</script>

<HealthShell path="/releases" unifiedNav maxWidth={1400} {note} {footer}>
  <ReleaseMasthead
    kicker={mastheadKicker}
    title={['Every deploy,', 'and what it carried']}
    strap={mastheadStrap}
    {tiles}
    queue={data.mode === 'owner'
      ? { pending: data.totals.pending, failed: data.totals.failed }
      : null}
    {busy}
    {busyMsg}
    onSummarise={summarise}
  />

  <ReleaseCadence
    kicker="B / Cadence · {data.cadence.length} weeks"
    cadence={data.cadence}
    {kindMix}
    shippedLabel={owner ? 'Entries' : 'Capabilities'}
    strap={cadenceStrap}
  />

  <section class="c">
    <div class="c-inner">
      <SectionHead
        kicker={logKicker}
        title={data.mode === 'owner' ? ['The log,', 'with its evidence'] : ['The log,', 'day by day']}
        strap={data.mode === 'owner'
          ? 'Open a release for its summary, its entries and the commits behind them. The filter above reads the same URL params the public view uses.'
          : 'Grouped by the day it went live. Version numbers are date-derived, and the backfilled releases carry approximate timestamps.'}
      />

      {#if data.mode === 'owner'}
        <ReleaseFilters
          owner
          kind={data.filters.kind}
          q={data.filters.q}
          impact={data.filters.impact}
          via={data.filters.via}
          vias={data.vias}
          {result}
        />
        <VersionLog
          items={data.items}
          filters={data.filters}
          hasMore={data.hasMore}
          {busy}
          onRegenerate={(id, version) => summarise({ id, force: true }, `re-summarising ${version}…`)}
        />
      {:else}
        <ReleaseFilters kind={data.filters.kind} q={data.filters.q} {result} />
        <CapabilityRecord items={data.items} />
      {/if}
    </div>
  </section>
</HealthShell>

<style>
  .c {
    background: var(--bg);
    color: var(--text-primary);
    padding: 0 clamp(20px, 3vw, 44px) clamp(52px, 6vw, 88px);
  }
  .c-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding-top: clamp(28px, 3.5vw, 48px);
    border-top: 1px solid var(--line-strong);
  }
</style>
