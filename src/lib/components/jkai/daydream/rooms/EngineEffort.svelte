<script lang="ts">
  // The effort dial: three shares, and what each one buys.
  //
  // A slider whose only feedback is its own number is a knob nobody can use —
  // "discover 70" says nothing about what changes. So every row prints the
  // RESOLVED numbers beside it, computed here with the same pure `resolveEffort`
  // the engine runs server-side, which means the read-out moves as you drag and
  // agrees with what the next tick will actually do.
  //
  // The write is `set_effort` on `/api/daydream/thoughts` and it sends the whole
  // triple, not the one share that moved: the endpoint merges, but sending all
  // three makes the request the same shape as the stored value and a dropped
  // key impossible. `change`, never `input` — a drag across the track would
  // otherwise POST twenty times.
  import { untrack } from 'svelte';
  import { DEFAULT_EFFORT, describeEffort, resolveEffort, type Effort } from '$lib/daydream/effort';
  import { postThought } from '$lib/daydream/feed-client';
  import RollupGrid from '$lib/components/jkai/daydream/hub/RollupGrid.svelte';
  import type { RollupCell } from '$lib/components/jkai/daydream/hub/types';

  interface Props {
    effort: Effort;
    /** The page's `invalidateAll` — the shares are server state, not local state. */
    onchanged: () => void;
  }

  let { effort, onchanged }: Props = $props();

  /** The three shares, as the sliders hold them. The prop is the truth; this is
   *  the truth mid-drag, and it is put back whenever the server answers.
   *  `untrack` on the seed because capturing the initial value IS the intent,
   *  and the compiler cannot tell that from a mistake (`state_referenced_locally`). */
  let local = $state<Effort>(untrack(() => ({ ...effort })));
  let busy = $state(false);
  let effortError = $state<string | null>(null);

  // The tracked read is hoisted out of the write, and the write is untracked:
  // an effect that both reads and writes the same state re-runs itself.
  $effect(() => {
    const next = effort;
    untrack(() => {
      local = { ...next };
    });
  });

  const ROWS = [
    {
      key: 'discover',
      label: 'Discover',
      meaning: 'finding new correlates — proposals, musings, leads, sweep breadth, lookups',
    },
    {
      key: 'test',
      label: 'Test',
      meaning: 'checking them — reviewer throughput, verify passes, rulings remembered',
    },
    { key: 'propose', label: 'Propose', meaning: 'saying them — candidates a compose pass' },
  ] as const;

  const resolved = $derived(resolveEffort(local));
  const lines = $derived(describeEffort(local));

  /** The resolved numbers for one share, as chips. Same values as the pulse
   *  summary line, split so a single number can be read at a glance. */
  function chips(key: keyof Effort): string[] {
    const r = resolved;
    if (key === 'discover')
      return [
        `${r.hypothesise.maxProposals} proposals`,
        `${r.ponder.maxMusings} musings`,
        `${r.ponder.maxLeads} leads`,
        `${r.sweep.maxSignals} signals`,
        `${r.explore.maxLeads} leads explored`,
        `${r.ponder.lookupBudget} lookups`,
      ];
    if (key === 'test')
      return [
        `${r.review.maxPerRun} reviews a pass`,
        `${r.review.backfillPerRun} rulings remembered`,
        `verify ${r.compose.verify ? 'on' : 'off'}`,
      ];
    return [
      `${r.compose.extraCandidates ? `+${r.compose.extraCandidates}` : 'no extra'} candidates a compose pass`,
    ];
  }

  /** `describeEffort` prefixes each line with the share and its value; the cell
   *  already prints the value as its figure, so only the tail is the summary. */
  function tail(line: string | undefined): string {
    if (!line) return '';
    const at = line.indexOf(': ');
    return at < 0 ? line : line.slice(at + 2);
  }

  const cells = $derived<RollupCell[]>(
    ROWS.map((row, i): RollupCell => {
      const v = local[row.key];
      return {
        key: row.key,
        label: row.label,
        value: String(v),
        sub: tail(lines[i]),
        tone: v === 50 ? 'steady' : v > 50 ? 'action' : 'quiet',
        corner: v === 50 ? 'as shipped' : v > 50 ? 'above' : 'below',
      };
    }),
  );

  async function commit() {
    busy = true;
    effortError = null;
    const r = await postThought({
      action: 'set_effort',
      effort: { discover: local.discover, test: local.test, propose: local.propose },
    });
    if (!r.ok) effortError = r.error ?? 'that did not save';
    else onchanged();
    busy = false;
  }

  async function shipped() {
    local = { ...DEFAULT_EFFORT };
    await commit();
  }

  const atShipped = $derived(
    local.discover === DEFAULT_EFFORT.discover &&
      local.test === DEFAULT_EFFORT.test &&
      local.propose === DEFAULT_EFFORT.propose,
  );
</script>

{#if effortError}<p class="err">{effortError}</p>{/if}

<div class="ef">
  {#each ROWS as row (row.key)}
    <div class="ef-row">
      <div class="ef-name">
        <label class="ef-label" for="ef-{row.key}">{row.label}</label>
        <p class="ef-mean">{row.meaning}</p>
      </div>

      <div class="ef-dial">
        <input
          id="ef-{row.key}"
          class="ef-range"
          type="range"
          min="0"
          max="100"
          step="5"
          disabled={busy}
          style="--fill: {local[row.key]}%"
          bind:value={local[row.key]}
          onchange={commit}
          aria-describedby="ef-out-{row.key}"
        />
        <div class="ef-ticks" aria-hidden="true">
          <span>0</span><span>50</span><span>100</span>
        </div>
      </div>

      <p class="ef-figure">{local[row.key]}</p>

      <p class="ef-chips" id="ef-out-{row.key}">
        {#each chips(row.key) as c (c)}<span class="ef-chip">{c}</span>{/each}
      </p>
    </div>
  {/each}
</div>

<div class="ef-actions">
  <button type="button" class="btn sm" disabled={busy || atShipped} onclick={shipped}>
    Back to shipped numbers
  </button>
</div>

<p class="note">
  Spend stays under the Codex caps in the budget section; the dial decides what the allowance is
  spent on. A value typed on a heartbeat row still wins over the dial.
</p>

<div class="ef-rollup">
  <RollupGrid {cells} min={160} />
</div>

<style>
  .ef {
    margin-top: 18px;
    border-top: 1px solid var(--line-hair);
  }

  /* Name and meaning, the dial, the figure — then the resolved chips across the
     full width, because six of them will not sit in a column. */
  .ef-row {
    display: grid;
    grid-template-columns: minmax(180px, 1.1fr) minmax(160px, 1.6fr) 56px;
    align-items: start;
    gap: 8px 20px;
    padding: 16px 0;
    border-bottom: 1px solid var(--line-hair);
  }

  .ef-name {
    min-width: 0;
  }
  .ef-label {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
  }
  .ef-mean {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .ef-dial {
    min-width: 0;
    padding-top: 2px;
  }

  /* The track is the element's own background, so the fill is one gradient
     driven by `--fill` — no second element, and it moves with the value. */
  .ef-range {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 8px;
    margin: 6px 0 0;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: linear-gradient(
      to right,
      var(--accent) 0 var(--fill, 50%),
      var(--surface-card) var(--fill, 50%) 100%
    );
    cursor: pointer;
  }
  .ef-range:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ef-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 22px;
    border: 1px solid var(--text-primary);
    border-radius: 0;
    background: var(--text-primary);
    cursor: pointer;
  }
  /* Firefox paints its own track over the element background; making it
     transparent lets the same gradient through. */
  .ef-range::-moz-range-track {
    height: 8px;
    background: transparent;
    border: 0;
  }
  .ef-range::-moz-range-thumb {
    width: 12px;
    height: 22px;
    border: 1px solid var(--text-primary);
    border-radius: 0;
    background: var(--text-primary);
    cursor: pointer;
  }
  .ef-range:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .ef-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }

  .ef-figure {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .ef-chips {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 2px 0 0;
  }
  .ef-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    padding: 3px 8px;
    white-space: nowrap;
  }

  .ef-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 14px;
  }

  .ef-rollup {
    margin-top: 22px;
  }

  /* Under 620px the three tracks stack: a 160px slider next to a 180px label
     is unusable, and the figure belongs beside the name, not below it. */
  @media (max-width: 620px) {
    .ef-row {
      grid-template-columns: 1fr 56px;
    }
    .ef-dial {
      grid-column: 1 / -1;
    }
  }
</style>
