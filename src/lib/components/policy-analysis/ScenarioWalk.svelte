<script lang="ts">
  // THE SCENARIO WALK-THROUGH — the eight standing conditions, one beat at a time.
  //
  // A scenario already IS a sequence in the contract: the condition changes, one
  // actor moves first, that produces downstream effects, those land on named
  // outcomes, somebody does or does not notice, and something would correct it.
  // Rendered as a paragraph it reads as an observation. Stepped through, it reads
  // as what it is — a story about behaviour under a condition the policy has to
  // survive, which is the form a policy professional already thinks in.
  //
  // No animation and no auto-advance: the reader sets the pace, because the point
  // is to stop on the beat they disagree with. `scenarioBeats` in `view.ts` does
  // the shaping, so what counts as a beat is testable without mounting anything.
  //
  // Resetting the beat happens in the CLICK, never in an effect. An effect that
  // reset the step would be reading the state it writes — the loop this codebase
  // has paid for before.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import { scenarioBeats } from '$lib/policy-analysis/view';

  interface Props {
    scenarios: Artefact[];
    artefacts: Artefact[];
    inspect: (id: string) => void;
  }

  let { scenarios, artefacts, inspect }: Props = $props();

  let chosen = $state(0);
  let step = $state(0);

  const scenario = $derived(scenarios[Math.min(chosen, Math.max(scenarios.length - 1, 0))] ?? null);
  const beats = $derived(scenario ? scenarioBeats(scenario, artefacts) : []);
  const at = $derived(Math.min(step, Math.max(beats.length - 1, 0)));
  const beat = $derived(beats[at] ?? null);

  const title = (s: Artefact) => String(s.data.scenario ?? '').replaceAll('_', ' ');

  function choose(index: number) { chosen = index; step = 0; }
  function move(delta: number) { step = Math.min(Math.max(at + delta, 0), Math.max(beats.length - 1, 0)); }
  function onkeydown(event: KeyboardEvent) {
    const by = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!by) return;
    event.preventDefault();
    move(by);
  }
</script>

{#if scenarios.length}
  <!--
    On screen the reader steps through one scenario; on paper they get all eight
    in full. A printed report that carried beat one of one condition would be
    hiding seven of the eight standing conditions the policy has to survive.
  -->
  <div class="print-all">
    {#each scenarios as s (s.id)}
      {@const beats = scenarioBeats(s, artefacts)}
      <article class="print-scenario">
        <h4>{title(s)} — {s.label}</h4>
        <p>{s.statement}</p>
        {#if beats.length}
          <ol>{#each beats as b (b.key)}<li><strong>{b.label}.</strong> {b.body}</li>{/each}</ol>
        {/if}
      </article>
    {/each}
  </div>

  <div class="walk">
    <div class="picker" role="tablist" aria-label="Standing conditions">
      {#each scenarios as s, index (s.id)}
        <button
          role="tab" class="pick" class:on={index === Math.min(chosen, scenarios.length - 1)}
          aria-selected={index === Math.min(chosen, scenarios.length - 1)}
          onclick={() => choose(index)}
        >{title(s)}</button>
      {/each}
    </div>

    {#if scenario}
      <article class="stage" aria-label="Scenario walk-through">
        <header>
          <p class="kicker-sm">{title(scenario)}</p>
          <h3>{scenario.label}</h3>
          <p class="premise">{scenario.statement}</p>
        </header>

        {#if beats.length}
          <div class="beat">
            <p class="beat-label">{beat?.label}</p>
            <p class="beat-body">{beat?.body}</p>
            {#if beat?.refs.length}
              <p class="beat-refs">
                {#each beat.refs as ref (ref)}<button class="link" onclick={() => inspect(ref)}>{artefacts.find((a) => a.id === ref)?.label ?? ref}</button>{/each}
              </p>
            {/if}
          </div>

          <div class="controls">
            <button class="nm-save-btn" onclick={() => move(-1)} onkeydown={onkeydown} disabled={at === 0}>← Back</button>
            <ol class="dots" aria-hidden="true">
              {#each beats as b, i (b.key)}<li class:on={i === at} class:seen={i < at}></li>{/each}
            </ol>
            <button class="nm-save-btn" onclick={() => move(1)} onkeydown={onkeydown} disabled={at >= beats.length - 1}>Next →</button>
          </div>
          <p class="muted">
            Beat {at + 1} of {beats.length}. With Back or Next focused, the arrow keys step through it.
            <button class="link" onclick={() => inspect(scenario.id)}>Sensitivity, assumptions and evidence →</button>
          </p>
        {:else}
          <p class="muted">This scenario recorded no sequence to step through. <button class="link" onclick={() => inspect(scenario.id)}>Open it →</button></p>
        {/if}
      </article>
    {/if}
  </div>
{/if}

<style>
  .walk { margin-top: 1.25rem; }
  .picker { display: flex; flex-wrap: wrap; gap: .35rem; }
  .pick {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label);
    text-transform: uppercase; background: none; border: 1px solid var(--line-strong); padding: .35rem .6rem;
    cursor: pointer; color: var(--text-secondary);
  }
  .pick:hover { background: var(--accent-tint-04); color: var(--text-primary); }
  .pick.on { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  .pick:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
  .stage { border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); padding: 1.25rem; margin-top: .8rem; }
  .stage h3 { margin: .2rem 0 .5rem; font-size: var(--fs-body-lg); }
  .premise { color: var(--text-secondary); margin: 0 0 1rem; }
  .beat { border-left: 2px solid var(--accent); padding-left: 1rem; min-height: 8rem; }
  .beat-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-ink); margin: 0; }
  .beat-body { font-size: var(--fs-body-lg); line-height: 1.55; margin: .4rem 0 0; }
  .beat-refs { display: flex; flex-wrap: wrap; gap: .75rem; margin: .6rem 0 0; font-size: var(--fs-label); }
  .controls { display: flex; align-items: center; gap: 1rem; margin: 1.25rem 0 .5rem; flex-wrap: wrap; }
  .dots { list-style: none; display: flex; gap: .35rem; padding: 0; margin: 0; }
  .dots li { width: .55rem; height: .55rem; border: 1px solid var(--line-strong); border-radius: 50%; }
  .dots li.seen { background: var(--line-strong); }
  .dots li.on { background: var(--accent); border-color: var(--accent); }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .link { font: inherit; background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  .print-all { display: none; }
  @media print {
    .walk { display: none; }
    .print-all { display: block; }
    .print-scenario { break-inside: avoid; padding: .6rem 0; border-top: 1px solid #999; }
    .print-scenario h4 { margin: 0 0 .2rem; font-size: var(--fs-body-lg); text-transform: capitalize; }
    .print-scenario ol { margin: .4rem 0 0; padding-left: 1.2rem; }
    .print-scenario li { padding: .15rem 0; }
  }
</style>
