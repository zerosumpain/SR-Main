<script lang="ts">
  // Solutions (2026-10-29): the register of everything a note set going —
  // trackers with their live progress first, then every step, follow-up and
  // solution, newest first, each with where it lives and how it turned out.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import { stamp } from '$lib/daydream/format';
  import { postThought } from '$lib/daydream/feed-client';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let busy = $state<string | null>(null);

  const running = $derived(data.trackers.filter((t) => !t.stoppedAt && !t.reportedAt));
  const ended = $derived(data.trackers.filter((t) => t.stoppedAt || t.reportedAt).reverse());

  const tiles = $derived<DeckTile[]>([
    { key: 'all', label: 'Solutions', value: String(data.summary.total), sub: 'everything a note set going', tone: 'steady', lit: true },
    { key: '30', label: 'Last 30 days', value: String(data.summary.last30), sub: 'steps carried out', tone: 'steady' },
    { key: 'run', label: 'Tracking now', value: String(running.length), sub: running.length ? 'checked every day' : 'no tracker running', tone: running.length ? 'good' : 'quiet' },
    {
      key: 'kind',
      label: 'Most used',
      value: data.summary.byKind[0]?.[0] ?? '—',
      sub: data.summary.byKind[0] ? `${data.summary.byKind[0][1]} time${data.summary.byKind[0][1] === 1 ? '' : 's'}` : 'none yet',
      tone: 'quiet',
    },
  ]);

  const STATE_WORDS: Record<string, string> = { done: 'Done', undone: 'Taken back', stopped: 'Stopped', running: 'Running' };

  function day(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  }

  async function stop(id: string) {
    busy = id;
    await postThought({ action: 'stop_tracker', trackerId: id });
    await invalidateAll();
    busy = null;
  }
</script>

<svelte:head><title>Solutions — Daydream</title></svelte:head>

{#if data.error}
  <section class="band"><div class="inner"><LoadErrorCard kicker="Solutions did not load" message={data.error} /></div></section>
{:else}
  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / What the notes set going"
        title={['The solutions', 'register']}
        strap="Every step a note carried out for you — a tracker, a diary entry, lights off, a build — with where it lives and how it turned out. Built from the notes themselves, so it cannot disagree with them."
      />
      <StatDeck {tiles} min={170} />
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="B / Trackers"
        title={['Measured,', 'every day']}
        strap="A tracker follows one reading against a daily target and compares it with the 28 days before it began. A day with no reading is missing, not a miss. The result comes to you when it ends."
      />
      {#if !data.trackers.length}
        <p class="none">No trackers yet. A note that suggests a habit or an experiment offers “Track it”.</p>
      {:else}
        <ul class="trackers">
          {#each [...running, ...ended] as t (t.id)}
            {@const p = t.progress}
            <li id="tracker-{t.id}" class="tracker" class:ended={t.stoppedAt || t.reportedAt}>
              <div class="t-head">
                <span class="t-label">{t.label}</span>
                <span class="t-state">{t.stoppedAt ? 'Stopped' : t.reportedAt ? 'Finished' : `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left`}</span>
              </div>
              <div class="t-bar" aria-hidden="true">
                <span class="t-fill" style="width: {Math.min(100, (p.daysIn / t.days) * 100)}%"></span>
              </div>
              <p class="t-line">{t.line}</p>
              <p class="t-meta">
                {day(t.startDay)} to {day(t.endDay)} · from <a href={`/jkai/daydreams?note=${encodeURIComponent(t.thoughtId)}`}>{t.noteTitle}</a>
                {#if !t.stoppedAt && !t.reportedAt}
                  · <button type="button" class="link-btn" disabled={busy === t.id} onclick={() => stop(t.id)}>Stop</button>
                {/if}
              </p>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="C / The register"
        title={['Everything,', 'newest first']}
        strap="Solutions, “Do it for me” steps and the ways a note was taken further."
      />
      {#if !data.entries.length}
        <p class="none">Nothing carried out yet. When a note's main button does something, it is recorded here.</p>
      {:else}
        <ol class="reg">
          {#each data.entries as e, i (`${e.thoughtId}-${e.kind}-${i}`)}
            <li class="row">
              <span class="r-when" title={stamp(e.at)}>{day(e.at.slice(0, 10))}</span>
              <span class="r-kind">{e.kind}</span>
              <span class="r-what">
                {#if e.href}<a href={e.href}>{e.what}</a>{:else}{e.what}{/if}
                <span class="r-note">from <a href={`/jkai/daydreams?note=${encodeURIComponent(e.thoughtId)}`}>{e.noteTitle}</a></span>
                {#if e.result}<span class="r-result">{e.result}</span>{/if}
              </span>
              <span class="r-state s-{e.state}">{STATE_WORDS[e.state]}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </section>
{/if}

<style>
  .none {
    color: var(--text-muted);
  }
  .trackers,
  .reg {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .trackers {
    gap: 14px;
  }
  .tracker {
    border: 1px solid var(--line-hair);
    padding: 12px 14px;
    background: var(--surface-raised, transparent);
  }
  .tracker.ended {
    opacity: 0.75;
  }
  .t-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .t-label {
    font-weight: 600;
  }
  .t-state,
  .t-meta,
  .r-when,
  .r-kind,
  .r-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .t-bar {
    height: 8px;
    margin: 8px 0;
    background: var(--surface-sunken);
    border: 1px solid var(--line-hair);
  }
  .t-fill {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .t-line {
    margin: 0 0 4px;
    font-size: var(--fs-body-sm);
  }
  .t-meta {
    margin: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 64px 140px minmax(0, 1fr) 90px;
    gap: 4px 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line-hair);
    align-items: baseline;
  }
  .r-what {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .r-note,
  .r-result {
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .r-result {
    color: var(--text-primary);
  }
  .r-state {
    text-align: right;
  }
  .s-running {
    color: var(--accent-ink);
  }
  .link-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
  }
  @media (max-width: 640px) {
    .row {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .r-kind {
      grid-column: 2;
      grid-row: 1;
    }
    .r-what {
      grid-column: 1 / -1;
    }
    .r-state {
      grid-column: 1 / -1;
      text-align: left;
    }
  }
</style>
