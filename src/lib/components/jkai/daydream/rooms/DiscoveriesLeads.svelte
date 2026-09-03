<script lang="ts">
  // Lines of enquiry: the arcs the ponder engine decided were worth weeks
  // rather than a sentence, and how each is going.
  //
  // Every row opens. The five numbers on a line — score, rounds, spawned,
  // held, state — summarise a process `run.ts` has been recording in full the
  // whole time (a `daydream_lead_steps` row at every plan, spawn, read, judge
  // and prune, with the reasoning and the tokens attached). A summary of an
  // audit trail nobody can open is a claim, not a record.
  //
  // The trace is fetched on expand: a lead can carry two hundred steps.
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { Facet } from '$lib/components/jkai/daydream/hub/types';
  import { leadTone, verdictTone } from '$lib/daydream/priority';
  import { postThought, stamp } from '$lib/daydream/feed-client';
  import { verdictLabel, type LeadDetailRow, type LeadRow } from './discoveries';

  interface Props {
    leads: LeadRow[];
    /** The states, counted and ordered by the page, so a chip and the rollup
     *  cell above it can never disagree about how many lines are parked. */
    states: Array<{ status: string; label: string; n: number }>;
    /** `all`, or one status. Lifted to the page so the rollup can set it. */
    status: string;
    onstatus: (id: string) => void;
  }

  let { leads, states, status, onstatus }: Props = $props();

  const statusFacets = $derived<Facet[]>([
    { id: 'all', label: 'All', count: leads.length },
    ...states.map((s) => ({ id: s.status, label: s.label, count: s.n })),
  ]);

  const visible = $derived(leads.filter((l) => status === 'all' || l.status === status));

  let leadOpen = $state<string | null>(null);
  let leadDetail = $state<Record<string, LeadDetailRow>>({});
  let leadError = $state<Record<string, string>>({});

  async function toggleLead(id: string) {
    if (leadOpen === id) {
      leadOpen = null;
      return;
    }
    leadOpen = id;
    if (leadDetail[id]) return;
    const { ok, out, error } = await postThought<{ detail?: LeadDetailRow }>({
      action: 'lead_detail',
      leadId: id,
    });
    if (!ok) {
      leadError = { ...leadError, [id]: error ?? 'that did not work' };
      return;
    }
    if (out.detail) leadDetail = { ...leadDetail, [id]: out.detail };
  }
</script>

{#if leads.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      No lines of enquiry yet. The ponder engine opens one when a pattern deserves weeks rather
      than a sentence.
    </p>
  </div>
{:else}
  <div class="controls">
    <FacetBar label="State" active={status} facets={statusFacets} onpick={onstatus} />
  </div>

  {#if visible.length === 0}
    <div class="card t-quiet">
      <p class="card-body">No line is in that state. The counts on the chips say where they all are.</p>
    </div>
  {:else}
    <div class="tbl-wrap framed">
      <table class="tbl">
        <thead>
          <tr>
            <th>Line</th>
            <th>Metrics</th>
            <th class="right">Score</th>
            <th class="right">Rounds</th>
            <th class="right">Held</th>
            <th class="right">State</th>
            <th class="right">Do</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as l (l.id)}
            <tr class:dim={l.status !== 'open'}>
              <td class="cell-lead">
                <span class="cell-title">{l.title}</span>
                <span class="cell-sub">{l.rationale}</span>
              </td>
              <td class="cell-wrap">{l.metrics.join(' · ')}</td>
              <td class="right num">{Math.round(l.score * 100) / 100}</td>
              <td class="right num">{l.roundsRun}</td>
              <td class="right num">{l.hypothesesHeld}/{l.hypothesesSpawned}</td>
              <td class="right"><span class="pill t-{leadTone(l.status)}">{l.status}</span></td>
              <td class="right nowrap">
                <button type="button" class="btn sm" onclick={() => toggleLead(l.id)}>
                  {leadOpen === l.id ? 'Hide' : 'Progress'}
                </button>
              </td>
            </tr>
            {#if leadOpen === l.id}
              <tr class="lead-detail-row">
                <td colspan="7">
                  {#if leadError[l.id]}
                    <p class="err">{leadError[l.id]}</p>
                  {:else if !leadDetail[l.id]}
                    <p class="detail-line">Reading the rounds…</p>
                  {:else}
                    {@const d = leadDetail[l.id]}
                    <div class="detail">
                      <div class="detail-block">
                        <p class="field-label">Where it stands</p>
                        <p class="detail-line">
                          {d.roundsRun} round{d.roundsRun === 1 ? '' : 's'} run,
                          {d.hypothesesSpawned} question{d.hypothesesSpawned === 1 ? '' : 's'} asked,
                          <b>{d.hypothesesHeld}</b> held.
                          {#if d.status === 'open'}
                            {d.barrenRounds} barren round{d.barrenRounds === 1 ? '' : 's'} in a row —
                            it is abandoned at {d.abandonAfterBarrenRounds}, so it has
                            {Math.max(0, d.abandonAfterBarrenRounds - d.barrenRounds)} left to produce
                            something.
                          {:else}
                            Closed as <b>{d.status}</b>.
                          {/if}
                          {#if d.fromSteer} Opened from one of your steers.{/if}
                          {#if d.lastRoundAt} Last round {stamp(d.lastRoundAt)}.{/if}
                          {#if d.tokens} {d.tokens} tokens across the trace.{/if}
                        </p>
                        {#if Object.keys(d.scoreComponents).length}
                          <div class="tbl-wrap framed">
                            <table class="tbl compact">
                              <thead><tr><th>Score component</th><th class="right">Value</th></tr></thead>
                              <tbody>
                                {#each Object.entries(d.scoreComponents) as [k, v] (k)}
                                  <tr><td>{k}</td><td class="right num">{Math.round(Number(v) * 1000) / 1000}</td></tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        {/if}
                      </div>

                      <div class="detail-block">
                        <p class="field-label">What it did, round by round</p>
                        {#if d.traceMissing}
                          <!-- Said out loud rather than rendered as an empty
                               list. A lead that advanced without tracing did
                               its thinking somewhere nobody can review, which
                               is a fault in the loop and not a quiet week. -->
                          <p class="note warn">
                            {d.roundsRun} rounds ran and wrote no trace. The reasoning behind them is
                            not recoverable — that is a gap in the loop, not an empty week.
                          </p>
                        {:else if d.steps.length === 0}
                          <p class="detail-line">
                            Nothing yet. The explore pass writes the first step when this line is
                            next advanced.
                          </p>
                        {:else}
                          <div class="tbl-wrap framed">
                            <table class="tbl compact">
                              <thead>
                                <tr>
                                  <th class="right">Round</th>
                                  <th>Step</th>
                                  <th>What happened</th>
                                  <th class="right">Tokens</th>
                                  <th class="right">When</th>
                                </tr>
                              </thead>
                              <tbody>
                                {#each d.steps as st, si (si)}
                                  <tr>
                                    <td class="right num">{st.round}</td>
                                    <td><span class="tag">{st.kind}</span></td>
                                    <td class="cell-wrap">{st.note}</td>
                                    <td class="right num">{st.tokens || '—'}</td>
                                    <td class="right nowrap">{stamp(st.at)}</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        {/if}
                      </div>

                      <div class="detail-block">
                        <p class="field-label">The questions inside its range</p>
                        {#if d.questions.length === 0}
                          <p class="detail-line">
                            None yet. A lead owns the questions whose metric pair sits inside its own
                            allow-list — derived, never claimed, so a line cannot inflate its own
                            record.
                          </p>
                          {#if d.hypothesesSpawned > 0}
                            <!-- The stored counter and the derived list disagree.
                                 `statsFor` recounts from the allow-list every
                                 round, so this means the lead's metrics have been
                                 narrowed since those questions were asked — they
                                 are still on the board, they are simply no longer
                                 inside this line. Saying so beats printing
                                 "6 asked" over an empty list. -->
                            <p class="note warn">
                              The row above counts {d.hypothesesSpawned}, so its metric list has
                              narrowed since those were asked. They are still on the board; they are
                              no longer inside this line's range.
                            </p>
                          {/if}
                        {:else}
                          <div class="tbl-wrap framed">
                            <table class="tbl compact">
                              <thead>
                                <tr>
                                  <th>Question</th>
                                  <th class="right">Verdict</th>
                                  <th class="right">r</th>
                                  <th class="right">n</th>
                                  <th class="right">Asked</th>
                                </tr>
                              </thead>
                              <tbody>
                                {#each d.questions as q (q.id)}
                                  <tr>
                                    <td class="cell-lead cell-wrap">
                                      <span class="cell-title">{q.question}</span>
                                      {#if q.summary}<span class="cell-sub">{q.summary}</span>{/if}
                                    </td>
                                    <td class="right">
                                      <span class="pill t-{verdictTone(q.verdict)}">{verdictLabel(q.verdict)}</span>
                                    </td>
                                    <td class="right num">{q.r != null ? q.r.toFixed(2) : '—'}</td>
                                    <td class="right num">{q.pairs ?? '—'}</td>
                                    <td class="right nowrap">{stamp(q.proposedAt)}</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                          <p class="note">
                            Every question here is also on the board above, where its days can be
                            opened one by one.
                          </p>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}

<style>
  /* Room-specific only. .tbl, .cell-lead, .cell-title, .detail and the rest
     are the layout's shared vocabulary. */
  .tbl-wrap.framed {
    border: 1px solid var(--card-border);
    margin-top: 14px;
  }

  .cell-sub {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 60ch;
    margin-top: 4px;
  }

  /* The drill-in row. It spans the whole table and must not inherit the row
     hover tint, which over a nested table reads as a selection. */
  .lead-detail-row > td {
    padding: 0 12px 14px;
    background: var(--bg-section);
  }
  .tbl tbody tr.lead-detail-row:hover {
    background: var(--bg-section);
  }
  .lead-detail-row :global(.detail) {
    margin-top: 0;
  }
</style>
