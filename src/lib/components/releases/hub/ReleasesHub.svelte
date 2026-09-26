<script lang="ts">
  // /releases — one document, two depths.
  //
  //   A  The record      how much has shipped, and what the queue looks like
  //   B  Cadence         how often it ships, and what those deploys carry
  //   C  The log         sessions → releases → commits for the owner
  //
  // Signed out, C is the capability record: the publicly-describable things
  // that went live, grouped by day, complete and indexable. Signed in, C is the
  // console that used to live at /admin/ops/releases — sessions grouped with
  // their linked releases, commits, evidence and summariser controls.
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
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import SectionHead from '$lib/components/shell/SectionHead.svelte';
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

  /** `1 entry` / `664 entries`. A filtered view lands on one often enough. */
  function plural(n: number, one: string, many: string): string {
    return `${fmt(n)} ${n === 1 ? one : many}`;
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
    const source: Tile = {
      label: data.mode === 'owner' ? 'Site code lines' : 'SR-Main code lines',
      value: fmt(data.sourceFootprint.categories.code.lines),
      note: data.mode === 'owner' ? `${data.sourceFootprint.repositories.length} repositories · see breakdown below` : 'current site build',
    };
    if (data.mode === 'owner') {
      const t = data.totals;
      return [
        { label: 'Releases', value: fmt(t.releases), note: 'in this view' },
        { label: 'Commits', value: fmt(t.commits) },
        { label: 'File changes', value: fmt(t.files) },
        { label: 'Lines', value: `+${fmt(t.insertions)}`, note: `−${fmt(t.deletions)} removed` },
        { label: 'Range', value: t.minDate ?? '—', note: `to ${t.maxDate ?? '—'}` },
        source,
      ];
    }
    const t = data.totals;
    return [
      { label: 'Releases', value: fmt(t.releases), note: `over ${fmt(t.days)} days` },
      { label: 'Shipped', value: fmt(t.shipped), note: 'described here' },
      { label: 'Commits', value: fmt(t.commits) },
      { label: 'Lines added', value: fmt(t.insertions) },
      { label: 'Files touched', value: fmt(t.files) },
      source,
    ];
  });

  const mastheadKicker = $derived(
    data.mode === 'owner'
      ? `A / The record · full read · ${plural(data.totals.releases, 'release', 'releases')}`
      : `A / The record · ${plural(data.totals.releases, 'release', 'releases')}`,
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
      ? 'Switch between deploy activity and lines added or removed by week. Select a week or kind to filter the release log. Changes here cover SR-Main releases.'
      : 'Switch between deploy activity and lines added or removed by week. Select a week or kind to filter the log; capabilities count only what this page can describe.',
  );

  // ——— C ————————————————————————————————————————————————————————————
  const logKicker = $derived(
    data.mode === 'owner'
      ? `C / Work and releases · page ${data.filters.page + 1}`
      : `C / What shipped · ${plural(data.items.length, 'entry', 'entries')}`,
  );

  const result = $derived(
    data.mode === 'owner'
      ? `${plural(data.totals.releases, 'release', 'releases')} matched`
      : `${plural(data.items.length, 'entry', 'entries')} matched`,
  );

  const footer = $derived(
    data.mode === 'owner'
      ? [
          'strangeramblings.com/releases · full read · commits, files and evidence',
          `${fmt(data.totals.pending)} pending · ${fmt(data.totals.failed)} failed`,
          'Owner view — full release evidence',
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
    sourceFootprint={data.sourceFootprint}
    queue={data.mode === 'owner'
      ? { pending: data.totals.pending, failed: data.totals.failed }
      : null}
    {busy}
    {busyMsg}
    onSummarise={summarise}
  />

  <section class="filters">
    <div class="filters-inner">
      {#if data.mode === 'owner' && data.sampleData}
        <p class="sample-note">Local preview · synthetic sessions and releases</p>
      {/if}
      {#if data.mode === 'owner'}
        <ReleaseFilters
          owner
          kind={data.filters.kind}
          q={data.filters.q}
          from={data.filters.from}
          to={data.filters.to}
          today={data.today}
          timeBuckets={data.timeBuckets}
          impact={data.filters.impact}
          via={data.filters.via}
          vias={data.vias}
          {result}
        />
      {:else}
        <ReleaseFilters
          kind={data.filters.kind}
          q={data.filters.q}
          from={data.filters.from}
          to={data.filters.to}
          today={data.today}
          timeBuckets={data.timeBuckets}
          kinds={data.kindOptions}
          {result}
        />
      {/if}
    </div>
  </section>

  <ReleaseCadence
    kicker={`B / Cadence · ${plural(data.cadence.length, 'week', 'weeks')}`}
    cadence={data.cadence}
    {kindMix}
    shippedLabel={owner ? 'Entries' : 'Capabilities'}
    strap={cadenceStrap}
    filters={data.filters}
  />

  <section class="c" id="release-log">
    <div class="c-inner">
      <SectionHead
        kicker={logKicker}
        title={data.mode === 'owner' ? ['From session', 'to shipped code'] : ['The log,', 'day by day']}
        strap={data.mode === 'owner'
          ? 'Sessions and indicative costs lead into the releases and commits linked by pull request. A PR can contain several sessions; production commits may be squashed, so the link is to the shared work, not an exact attribution. Open a release for its evidence.'
          : 'Grouped by the day it went live. Version numbers are date-derived, and the backfilled releases carry approximate timestamps.'}
      />

      {#if data.mode === 'owner'}
        <VersionLog
          items={data.items}
          sessions={data.sessions}
          filters={data.filters}
          hasMore={data.hasMore}
          {busy}
          onRegenerate={(id, version) => summarise({ id, force: true }, `re-summarising ${version}…`)}
        />
      {:else}
        <CapabilityRecord items={data.items} />
      {/if}
    </div>
  </section>

</HealthShell>

<style>
  .filters { background: var(--bg); color: var(--text-primary); padding: 10px clamp(20px, 3vw, 44px) 0; }
  .filters-inner { max-width: 1400px; margin: 0 auto; }
  .c {
    background: var(--bg);
    color: var(--text-primary);
    padding: 0 clamp(20px, 3vw, 44px) clamp(42px, 5vw, 68px);
  }
  .c-inner {
    max-width: 1400px;
    margin: 0 auto;
    padding-top: clamp(20px, 2.5vw, 34px);
    border-top: 1px solid var(--line-strong);
  }
  .sample-note { margin: 0 0 16px; padding: 8px 10px; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-06); color: var(--text-secondary); font: var(--fs-label) var(--font-mono); }
</style>
