<script lang="ts">
  // Where the work comes from, and whether the queue is draining.
  //
  // The room could always say what the engine BUILT and never why it was
  // asked. "It shipped a tool last night" arrived without "because you asked
  // about this four times", so there was no way to tell a queue fed by real
  // questions from one feeding on its own faults.
  //
  // Every channel is a filter: press one and the board below shows only what
  // it caused.
  import type { IdeaSource, InflowView } from '$lib/selfimprove/board';

  interface Props {
    flow: InflowView;
    /** Channels currently filtering the board. */
    active: ReadonlyArray<IdeaSource>;
    ontoggle: (source: IdeaSource) => void;
    /** Tonight's ceilings, read from WORK_CAPS/BUDGET_CAPS on the server. */
    caps: { tools: number; builds: number; watches: number; repairs: number; calls: number; minutes: number; window: string };
  }

  let { flow, active, ontoggle, caps }: Props = $props();

  /** The meter is drawn against whichever of the three bars is longest, so the
   *  drain is visibly short rather than scaled to look adequate. */
  const peak = $derived(Math.max(flow.intake, flow.drained, flow.standing, 1));
  function pct(n: number): number {
    return Math.round((n / peak) * 100);
  }

  /** A channel that has produced nothing recently is quiet, not urgent. */
  function tone(recent: number, served: number): string {
    if (served > 0) return 'urgent';
    if (recent > 0) return 'action';
    return 'quiet';
  }
</script>

<div class="if-strip">
  {#each flow.channels as c (c.source)}
    <button
      type="button"
      class="chan t-{tone(c.recent, c.served)}"
      class:on={active.includes(c.source)}
      class:gap={c.source === 'unattributed'}
      aria-pressed={active.includes(c.source)}
      onclick={() => ontoggle(c.source)}
    >
      <span class="chan-fig">{c.recent}<span class="of">/{c.total}</span></span>
      <span class="chan-lab">{c.label}</span>
      <span class="chan-sub">
        {c.from}<br />
        {c.open} still open{#if c.served} · <span class="served">{c.served} already served</span>{/if}
      </span>
    </button>
  {/each}
</div>

{#if flow.channels.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      Nothing in the queue carries a channel yet. Ideas stamp themselves from tonight; the
      rows already queued read <strong>before this was recorded</strong>, because there is no
      way to recover which channel they came through and a guess is not a record.
    </p>
  </div>
{/if}

<!-- ── Is it draining? ──────────────────────────────────────────────────── -->
<div class="meter">
  <div class="m-row">
    <span class="m-lab">In, {flow.windowDays} days</span>
    <span class="m-track"><i class="m-fill in" style="width:{pct(flow.intake)}%"></i></span>
    <span class="m-val"><b>{flow.intake}</b> queued</span>
  </div>
  <div class="m-row">
    <span class="m-lab">Out, {flow.windowDays} days</span>
    <span class="m-track"><i class="m-fill out" style="width:{pct(flow.drained)}%"></i></span>
    <span class="m-val"><b>{flow.drained}</b> shipped or parked</span>
  </div>
  <div class="m-row">
    <span class="m-lab">Standing queue</span>
    <span class="m-track"><i class="m-fill held" style="width:{pct(flow.standing)}%"></i></span>
    <span class="m-val"><b>{flow.standing}</b> open</span>
  </div>
  {#if flow.ratio != null && flow.ratio > 1}
    <p class="verdict bad">
      <b>{flow.ratio} : 1</b> — the pile grows on a night the engine works perfectly. Anything
      that closes work out counts double: folding a restatement, parking a theme, ruling on a
      lead.
    </p>
  {:else if flow.ratio != null}
    <p class="verdict good"><b>{flow.ratio} : 1</b> — the queue is draining.</p>
  {:else}
    <p class="verdict">Nothing has settled in this window, so there is no ratio to report.</p>
  {/if}
</div>

<!-- ── What fits tonight ────────────────────────────────────────────────── -->
<div class="caps">
  <div class="cap"><span class="c-v">{caps.tools}</span><span class="c-l">tool slots</span></div>
  <div class="cap"><span class="c-v">{caps.builds}</span><span class="c-l">repo build</span></div>
  <div class="cap"><span class="c-v">{caps.watches}</span><span class="c-l">watch</span></div>
  <div class="cap"><span class="c-v">{caps.repairs}</span><span class="c-l">repairs</span></div>
  <div class="cap"><span class="c-v">{caps.calls}</span><span class="c-l">llm calls</span></div>
  <div class="cap"><span class="c-v">{caps.minutes}<span class="unit">m</span></span><span class="c-l">wall clock</span></div>
  <div class="cap wide"><span class="c-v">{caps.window}</span><span class="c-l">tonight's window</span></div>
</div>

<p class="note">
  Ceilings from <code>WORK_CAPS</code> and <code>BUDGET_CAPS</code>. Wall clock is the real
  constraint — the run has {caps.minutes} minutes before the next scheduled job — so a phase
  that runs late is skipped rather than overrunning into it.
  {#if flow.unattributed > 0}
    <br /><strong>{flow.unattributed}</strong> rows predate the channel stamp and can never
    be attributed; they get their own cell rather than being spread across the others on a
    guess.
  {/if}
</p>

<style>
  /* ── channels ─────────────────────────────────────────────────────────── */
  .if-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    border: 1px solid var(--card-border);
    border-right: 0;
    margin-bottom: 22px;
  }
  .chan {
    --tone: var(--text-ghost);
    border: 0;
    border-right: 1px solid var(--card-border);
    border-top: 3px solid transparent;
    background: transparent;
    padding: 14px 15px 16px;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    display: block;
    min-width: 0;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out);
  }
  .chan.t-urgent { --tone: var(--error); }
  .chan.t-action { --tone: var(--accent); }
  .chan.t-quiet { --tone: var(--text-ghost); }
  .chan:hover {
    background: var(--accent-tint-04);
  }
  .chan:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .chan.on {
    border-top-color: var(--accent);
    background: var(--accent-tint-08);
  }
  /* A gap in the record reads as one — never as a busy channel. */
  .chan.gap .chan-fig,
  .chan.gap .chan-lab {
    color: var(--text-ghost);
  }
  .chan-fig {
    display: block;
    font-family: var(--font-display);
    font-size: 26px;
    line-height: 1;
    letter-spacing: -0.025em;
    color: var(--tone);
  }
  .chan-fig .of {
    font-size: var(--fs-label);
    color: var(--text-ghost);
    letter-spacing: 0;
  }
  .chan-lab {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin-top: 9px;
  }
  .chan-sub {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
    margin-top: 5px;
  }
  .served {
    color: var(--error);
  }

  /* ── the meter ────────────────────────────────────────────────────────── */
  .meter {
    border: 1px solid var(--card-border);
    background: var(--surface-overlay);
  }
  .m-row {
    display: grid;
    grid-template-columns: minmax(120px, 160px) 1fr minmax(150px, 230px);
    gap: 14px;
    align-items: center;
    padding: 11px 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  .m-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .m-track {
    position: relative;
    display: block;
    height: 14px;
    background: var(--card-bg);
  }
  .m-fill {
    position: absolute;
    inset: 0 auto 0 0;
    display: block;
  }
  .m-fill.in {
    background: var(--accent);
  }
  .m-fill.out {
    background: var(--good);
  }
  .m-fill.held {
    background: repeating-linear-gradient(135deg, var(--accent-tint-35) 0 6px, transparent 6px 12px);
  }
  .m-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-align: right;
  }
  .m-val b {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .verdict {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0;
    padding: 13px 16px;
  }
  .verdict b {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    letter-spacing: -0.01em;
  }
  .verdict.bad {
    background: var(--error-bg);
    border-top: 1px solid var(--error-border);
  }
  .verdict.bad b {
    color: var(--error);
  }
  .verdict.good b {
    color: var(--good);
  }

  /* ── capacity ─────────────────────────────────────────────────────────── */
  .caps {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--card-border);
    border-top: 0;
  }
  .cap {
    flex: 1 1 110px;
    padding: 11px 15px 13px;
    border-right: 1px solid var(--line-hair);
  }
  .cap.wide {
    flex: 1 1 170px;
  }
  .cap:last-child {
    border-right: 0;
  }
  .c-v {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-body-lg);
    font-weight: 700;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .c-v .unit {
    font-size: var(--fs-label);
    font-weight: 400;
    color: var(--text-ghost);
  }
  .c-l {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-top: 5px;
  }
</style>
