<script lang="ts">
  // Every daydream activity as one even cell, grouped by the stage of the loop
  // it belongs to.
  //
  // This replaces the jobs TABLE, which was thirteen rows of mono text at the
  // very bottom of the tab — the last thing you reached on a page about
  // whether the engine is working, and the only thing on it that actually
  // answered the question. A table also flattens the loop: `observe` and
  // `weekly` are adjacent rows with nothing to say that one feeds the other
  // through four stages of work.
  //
  // So the panel is the stage order — observe, discover, test, propose,
  // improve — and within a stage the worst thing first. An activity nobody
  // mapped lands in `other` rather than vanishing: a stage list that silently
  // drops a new activity is the same conflation ("missing" reading as "quiet")
  // this whole room exists to prevent. The table survives underneath, folded
  // away, for the columns a cell has no room for.
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';
  import { TONE_RANK, jobTone } from '$lib/daydream/priority';
  import { ago, cadence, usd, when } from './engine-format';

  interface JobRow {
    name: string;
    status: string;
    cadenceSeconds: number | null;
    lastRunAt: string | Date | null;
    consecutiveFailures: number;
    pulse: { ts: string | Date; outcome: string; summary: string | null } | null;
  }

  interface Schedule {
    name: string;
    description: string;
    status: string;
    nextRunAt: string | null;
    costUsd24h: number;
    runs24h: number;
  }

  interface Props {
    jobs: JobRow[];
    schedules: Schedule[];
    /** A cell is an instrument: clicking opens its mechanics. */
    onopen?: (name: string, stageMark: string) => void;
  }

  let { jobs, schedules, onopen = undefined }: Props = $props();

  /** The loop, in the order it runs. `mark` is the three-letter stage tag the
   *  cell wears, so a cell still says which stage it belongs to once the grid
   *  has wrapped and the heading has scrolled off. */
  const STAGES = [
    {
      id: 'observe',
      mark: 'obs',
      label: 'Observe',
      blurb: 'What it takes in.',
      names: ['observe', 'places', 'signals', 'features', 'bank', 'spend', 'offers', 'mail', 'notebook', 'memory'],
    },
    {
      id: 'discover',
      mark: 'dis',
      label: 'Discover',
      blurb: 'What it goes looking for.',
      names: ['sweep', 'hypothesise', 'explore', 'ponder', 'intel'],
    },
    { id: 'test', mark: 'tst', label: 'Test', blurb: 'What it checks before speaking.', names: ['review', 'rulesmith'] },
    {
      id: 'propose',
      mark: 'pro',
      label: 'Propose',
      blurb: 'What reaches you.',
      names: ['compose', 'suggest', 'detect', 'digest', 'weekly'],
    },
    { id: 'improve', mark: 'imp', label: 'Improve', blurb: 'What it does to itself.', names: ['improve'] },
    { id: 'other', mark: 'oth', label: 'Other', blurb: 'Activities no stage claims yet.', names: [] },
  ] as const;

  type Activity = {
    job: JobRow;
    short: string;
    stage: (typeof STAGES)[number];
    schedule: Schedule | null;
  };

  const byName = $derived(new Map(schedules.map((s) => [s.name, s])));

  const activities = $derived.by((): Activity[] =>
    jobs.map((job) => {
      const short = job.name.replace(/^daydream-/, '');
      const stage = STAGES.find((s) => (s.names as readonly string[]).includes(short)) ?? STAGES[STAGES.length - 1];
      return { job, short, stage, schedule: byName.get(job.name) ?? null };
    }),
  );

  /** Worst first — a failing pass is the loudest thing in this room. */
  function worstFirst(rows: Activity[]): Activity[] {
    return [...rows].sort(
      (a, b) => TONE_RANK[jobTone(a.job)] - TONE_RANK[jobTone(b.job)] || a.short.localeCompare(b.short),
    );
  }

  const ordered = $derived(worstFirst(activities));
  const failing = $derived(ordered.filter((a) => jobTone(a.job) === 'urgent'));

  const groups = $derived(
    STAGES.map((stage) => ({
      stage,
      rows: worstFirst(activities.filter((a) => a.stage.id === stage.id)),
    })).filter((g) => g.rows.length > 0),
  );

  function cell(a: Activity): RollupCell {
    const paused = a.schedule && a.schedule.status !== 'active' ? `${a.schedule.status} · ` : '';
    return {
      key: a.job.name,
      mark: a.stage.mark,
      label: a.short,
      value: a.job.pulse ? a.job.pulse.outcome : 'never',
      tone: jobTone(a.job),
      corner: usd(a.schedule?.costUsd24h),
      onclick: onopen ? () => onopen(a.job.name, a.stage.mark) : null,
      sub:
        `${paused}every ${cadence(a.job.cadenceSeconds)} · ` +
        `last ${ago(a.job.pulse?.ts ?? a.job.lastRunAt)} · ` +
        `next ${when(a.schedule?.nextRunAt)}`,
    };
  }
</script>

{#if jobs.length === 0}
  <div class="card t-quiet">
    <p class="card-body">No daydream activity is registered, so nothing is scheduled to run.</p>
  </div>
{:else}
  {#if failing.length}
    <div class="card t-urgent">
      <p class="card-kicker">Failing</p>
      <p class="card-body">
        {failing.map((a) => `${a.short} (${a.job.consecutiveFailures || 1} in a row)`).join(', ')} —
        everything downstream of these is a zero about the engine, not about your life.
      </p>
    </div>
  {/if}

  <div class="stages">
    {#each groups as g (g.stage.id)}
      <section class="stage">
        <header class="stage-hd">
          <p class="stage-kicker">{g.stage.label}<span class="stage-n">{g.rows.length}</span></p>
          <p class="stage-blurb">{g.stage.blurb}</p>
        </header>
        <RollupGrid cells={g.rows.map(cell)} min={168} dense />
      </section>
    {/each}
  </div>

  <details class="fold">
    <summary>As a table</summary>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>Activity</th>
            <th>Stage</th>
            <th>Every</th>
            <th>Last outcome</th>
            <th>Next</th>
            <th class="right">24h</th>
            <th>Said</th>
          </tr>
        </thead>
        <tbody>
          {#each ordered as a (a.job.name)}
            <tr>
              <td class="nowrap">{a.short}</td>
              <td class="nowrap"><span class="mark">{a.stage.mark}</span></td>
              <td class="nowrap">{cadence(a.job.cadenceSeconds)}</td>
              <td class="nowrap">
                <span class="pill t-{jobTone(a.job)}">{a.job.pulse ? a.job.pulse.outcome : 'never'}</span>
                <span class="meta-item">{a.job.pulse ? ago(a.job.pulse.ts) : ''}</span>
              </td>
              <td class="nowrap">{when(a.schedule?.nextRunAt)}</td>
              <td class="right num">{usd(a.schedule?.costUsd24h) ?? '—'}</td>
              <td class="cell-lead cell-wrap">{a.job.pulse?.summary ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
{/if}

<style>
  .stages {
    display: flex;
    flex-direction: column;
    gap: 26px;
    margin-top: 18px;
  }

  .stage-hd {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--text-primary);
  }
  .stage-kicker {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .stage-n {
    color: var(--text-ghost);
  }
  .stage-blurb {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .fold {
    margin-top: 26px;
  }
  .fold summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
    padding: 8px 0;
  }
  .fold summary:hover {
    color: var(--text-primary);
  }
</style>
