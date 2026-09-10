<script lang="ts">
  // THE SCENARIO FLOW — a condition the policy has to survive, drawn as a
  // process rather than read as a paragraph.
  //
  // Ask 9: "the steps are good, but what about a process flow?" They were good;
  // they were also one beat at a time behind Back and Next, so the reader could
  // see the step they were on and never the shape of the thing. A flow shows
  // both — every beat as a numbered stage on one rail, the current one open
  // beneath it — and the shape is the finding: a scenario whose detection beat
  // is empty is a condition the policy would not notice, and you can see that
  // without reading a word.
  //
  // `scenarioBeats` in `view.ts` does the shaping, unchanged and already tested.
  // This is a presentation over it.
  //
  // Resetting the beat happens in the CLICK, never in an effect. An effect that
  // reset the step would be reading the state it writes — the loop this codebase
  // has paid for before.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { scenarioBeats } from '$lib/policy-analysis/view';

  interface Props {
    scenarios: Artefact[];
    artefacts: Artefact[];
    onopen: (id: string) => void;
  }

  let { scenarios, artefacts, onopen }: Props = $props();

  let chosen = $state(0);
  let step = $state(0);

  const index = $derived(Math.min(chosen, Math.max(scenarios.length - 1, 0)));
  const scenario = $derived(scenarios[index] ?? null);
  const beats = $derived(scenario ? scenarioBeats(scenario, artefacts) : []);
  const at = $derived(Math.min(step, Math.max(beats.length - 1, 0)));
  const beat = $derived(beats[at] ?? null);

  const title = (s: Artefact) => String(s.data.scenario ?? '').replaceAll('_', ' ');
  const named = (ref: string) => artefacts.find((a) => a.id === ref)?.label ?? ref;

  function choose(i: number) {
    chosen = i;
    step = 0;
  }
  function move(delta: number) {
    step = Math.min(Math.max(at + delta, 0), Math.max(beats.length - 1, 0));
  }
  function onRailKey(event: KeyboardEvent) {
    const by = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!by) return;
    event.preventDefault();
    move(by);
  }
</script>

{#if scenarios.length}
  <!--
    On screen the reader walks one condition; on paper they get all of them in
    full. A printed report carrying beat one of one condition would be hiding
    every other condition the policy has to survive.
  -->
  <div class="sf-print">
    {#each scenarios as s (s.id)}
      {@const all = scenarioBeats(s, artefacts)}
      <article class="sf-print-one">
        <h4>{title(s)} — {s.label}</h4>
        <p>{s.statement}</p>
        {#if all.length}
          <ol>{#each all as b (b.key)}<li><strong>{b.label}.</strong> {b.body}</li>{/each}</ol>
        {/if}
      </article>
    {/each}
  </div>

  <div class="sf">
    <div class="sf-picker" role="tablist" aria-label="Standing conditions">
      {#each scenarios as s, i (s.id)}
        {@const count = scenarioBeats(s, artefacts).length}
        <button
          type="button"
          role="tab"
          class="sf-pick"
          class:on={i === index}
          aria-selected={i === index}
          onclick={() => choose(i)}
        >
          <span class="sf-pick-name">{title(s)}</span>
          <span class="sf-pick-count">{count}</span>
        </button>
      {/each}
    </div>

    {#if scenario}
      <article class="sf-stage" aria-label="Scenario walk-through">
        <header class="sf-head">
          <p class="sf-kicker">{title(scenario)}</p>
          <h3>{scenario.label}</h3>
          <p class="sf-premise">{scenario.statement}</p>
        </header>

        {#if beats.length}
          <!--
            The rail IS the process flow: every beat visible at once, numbered,
            with the one being read lit. A reader can see there are six stages
            and that the fifth is "would anyone see it?" before clicking
            anything, which is the whole gain over Back and Next.
          -->
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <ol class="sf-rail" role="tablist" aria-label="Beats" onkeydown={onRailKey}>
            {#each beats as b, i (b.key)}
              <li class="sf-rail-item" class:on={i === at} class:done={i < at}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={i === at}
                  tabindex={i === at ? 0 : -1}
                  class="sf-node"
                  onclick={() => (step = i)}
                >
                  <span class="sf-node-num">{i + 1}</span>
                  <span class="sf-node-label">{b.label}</span>
                </button>
              </li>
            {/each}
          </ol>

          <div class="sf-beat" aria-live="polite">
            <p class="sf-beat-label">{beat?.label}</p>
            <p class="sf-beat-body">{beat?.body}</p>
            {#if beat?.refs.length}
              <p class="sf-beat-refs">
                {#each beat.refs as ref (ref)}
                  <button type="button" class="sf-ref" data-pa-peek={`artefact:${ref}`} onclick={() => onopen(ref)}>{named(ref)}</button>
                {/each}
              </p>
            {/if}
          </div>

          <div class="sf-controls">
            <button type="button" class="sf-btn" onclick={() => move(-1)} disabled={at === 0}>← Previous</button>
            <span class="sf-progress">Beat {at + 1} of {beats.length}</span>
            <button type="button" class="sf-btn" onclick={() => move(1)} disabled={at >= beats.length - 1}>Next →</button>
            <button type="button" class="sf-btn sf-ghost" onclick={() => onopen(scenario.id)}>Assumptions and evidence →</button>
          </div>
        {:else}
          <p class="sf-empty">
            This condition was recorded without a sequence, so there is nothing to step through. Open it to
            read what the assessment did establish.
          </p>
        {/if}
      </article>
    {/if}
  </div>
{:else}
  <p class="sf-empty">
    No standing condition has been produced yet. Scenarios arrive at stage ten of thirteen, so they are late
    in a run.
  </p>
{/if}

<style>
  .sf-print {
    display: none;
  }

  .sf-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    background: var(--line-strong);
    border: 1px solid var(--line-strong);
    margin-top: 20px;
  }
  .sf-pick {
    flex: 1 1 auto;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: var(--bg);
    border: 0;
    border-radius: 0;
    padding: 9px 11px;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .sf-pick:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .sf-pick.on {
    background: var(--accent);
    color: var(--bg);
  }
  .sf-pick-count {
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .sf-pick.on .sf-pick-count {
    color: rgba(237, 228, 212, 0.75);
  }

  .sf-stage {
    border: 1px solid var(--line-strong);
    border-top: 0;
    padding: 20px 22px 22px;
  }
  .sf-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 7px;
  }
  .sf-head h3 {
    font-size: var(--fs-body-lg);
    font-weight: 700;
    margin: 0;
    line-height: 1.3;
  }
  .sf-premise {
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 8px 0 0;
    max-width: 70ch;
  }

  /* The flow. A row of numbered stages joined by a hairline, wrapping on narrow
     screens into a column — the connector is a border rather than a drawn line
     so it reflows for free. */
  .sf-rail {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    padding: 0;
    margin: 22px 0 0;
    border: 1px solid var(--divider);
  }
  .sf-rail-item {
    flex: 1 1 9rem;
    min-width: 0;
    border-right: 1px solid var(--divider);
    position: relative;
  }
  .sf-rail-item:last-child {
    border-right: 0;
  }
  .sf-node {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    font: inherit;
    background: var(--bg);
    border: 0;
    border-radius: 0;
    border-top: 3px solid transparent;
    padding: 10px 11px 12px;
    color: var(--text-muted);
    cursor: pointer;
    text-align: left;
    min-height: 100%;
    box-sizing: border-box;
  }
  .sf-node:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }
  .sf-rail-item.done .sf-node {
    color: var(--text-secondary);
    border-top-color: var(--accent-tint-35);
  }
  .sf-rail-item.on .sf-node {
    background: var(--accent-tint-08);
    border-top-color: var(--accent);
    color: var(--text-primary);
  }
  .sf-node-num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .sf-rail-item.on .sf-node-num {
    color: var(--accent);
  }
  .sf-node-label {
    font-size: var(--fs-label);
    line-height: 1.35;
    text-wrap: pretty;
  }

  .sf-beat {
    margin-top: 20px;
    border-left: 3px solid var(--accent);
    padding: 4px 0 4px 16px;
  }
  .sf-beat-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 7px;
  }
  .sf-beat-body {
    font-size: var(--fs-body);
    line-height: 1.65;
    margin: 0;
    max-width: 70ch;
    text-wrap: pretty;
  }
  .sf-beat-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 10px 0 0;
  }

  .sf-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 11px;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--divider);
  }
  .sf-btn {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 6px 11px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .sf-btn:hover:not(:disabled),
  .sf-btn:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sf-btn:disabled {
    color: var(--text-ghost);
    border-color: var(--divider);
    cursor: default;
  }
  .sf-ghost {
    border: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    margin-left: auto;
    padding-left: 0;
    padding-right: 0;
  }
  .sf-progress {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .sf-ref {
    font: inherit;
    font-size: var(--fs-label);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }
  .sf-ref:hover {
    color: var(--accent);
  }

  .sf-empty {
    border-left: 2px solid var(--line-strong);
    padding-left: 14px;
    color: var(--text-secondary);
    max-width: 66ch;
  }

  @media print {
    .sf {
      display: none !important;
    }
    .sf-print {
      display: block;
    }
    .sf-print-one {
      break-inside: avoid;
      margin-bottom: 14pt;
    }
    .sf-print-one h4 {
      text-transform: capitalize;
      margin-bottom: 4pt;
    }
  }
</style>
