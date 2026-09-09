<script lang="ts">
  import { onMount } from 'svelte';
  import ChartArtifact from '$lib/components/jkai/artifacts/ChartArtifact.svelte';
  import ActorMap from './ActorMap.svelte';
  import type { ChartArtifact as Chart } from '$lib/workflows/site-tools/artifact-types';
  import type { PolicyGame } from '$lib/policy-incentives-lab/schemas';
  import type { Result } from '$lib/policy-incentives-lab/server/engine';
  let { game, result }: { game: PolicyGame; result: Result } = $props();
  let frame = $state(0); let playing = $state(false); let reducedMotion = $state(false); let selectedActor = $state('');
  const sequential = $derived(result.rounds.length > 0);
  const frames = $derived(sequential ? result.rounds : result.terminal_outcomes);
  const current = $derived(frames[frame]);
  const timeline = $derived({ type: 'chart', title: 'Choices in the saved simulation', data: frames.flatMap((row, index) => game.actors.map(actor => ({ step: index + 1, actor: actor.name, choice: game.strategies.find(s => s.id === row.profile[actor.id])?.name ?? row.profile[actor.id], payoff: row.payoffs[actor.id] }))), spec: { mark: { type: 'rect', stroke: 'white', strokeWidth: 1 }, encoding: { x: { field: 'step', type: 'ordinal', title: sequential ? 'Round' : 'Alternative terminal profile', axis: { labelOverlap: true } }, y: { field: 'actor', type: 'nominal', title: 'Modelled group' }, color: { field: 'choice', type: 'nominal', title: 'Configured choice' }, tooltip: [{ field: 'actor', type: 'nominal' }, { field: 'step', type: 'ordinal' }, { field: 'choice', type: 'nominal' }, { field: 'payoff', type: 'quantitative' }] } } } as Chart);
  onMount(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => { reducedMotion = media.matches; if (reducedMotion) playing = false; }; update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); });
  $effect(() => { if (!playing || !sequential || reducedMotion) return; const timer = setInterval(() => { if (frame >= frames.length - 1) playing = false; else frame++; }, 1000); return () => clearInterval(timer); });
</script>
<section class="replay" aria-label="Simulation visualisation">
  <h3>Simulation visualisation</h3>
  <p>This replays saved calculations, not people or a new model run. Network links show configured interactions; node position and size have no quantitative meaning.</p>
  {#if current}
    {#if !sequential}<p>These are alternative calculated terminal profiles, not a sequence of events. Selecting one does not make it more likely.</p>{/if}
    <div class="controls">
      {#if sequential}<button disabled={reducedMotion || frames.length < 2} onclick={() => { if (frame === frames.length - 1) frame = 0; playing = !playing; }}>{playing ? 'Pause replay' : 'Play saved rounds'}</button>{/if}
      <button disabled={frame === 0} onclick={() => { playing = false; frame--; }}>Previous {sequential ? 'round' : 'profile'}</button>
      <button disabled={frame >= frames.length - 1} onclick={() => { playing = false; frame++; }}>Next {sequential ? 'round' : 'profile'}</button>
      <label>{sequential ? 'Round' : 'Terminal profile'} {frame + 1} of {frames.length}<input aria-label={sequential ? 'Replay round' : 'Terminal profile'} type="range" min="0" max={frames.length - 1} value={frame} oninput={e => { playing = false; frame = Number(e.currentTarget.value); }} /></label>
    </div>
    {#if reducedMotion}<p>Reduced motion is enabled. Use the round controls to inspect each saved state.</p>{/if}
    <div class="readout" aria-live={playing ? 'off' : 'polite'}>
      {#each game.actors as actor}<article><h4>{actor.name}</h4><p>{game.strategies.find(s => s.id === current.profile[actor.id])?.name ?? 'No choice recorded'}</p><p>Calculated payoff: <strong>{current.payoffs[actor.id]}</strong></p></article>{/each}
    </div>
    <p>Payoffs are weighted scores in this model. They are not money or comparable across groups unless the approved model defines them that way.</p>
    <ActorMap {game} compact calculation={current} onSelect={id => selectedActor = id} />
    {#if selectedActor}<p>Selected: {game.actors.find(a => a.id === selectedActor)?.name} · choice {game.strategies.find(s => s.id === current.profile[selectedActor])?.name} · payoff {current.payoffs[selectedActor]}</p>{/if}
    <h4>Outcomes at this {sequential ? 'round' : 'profile'}</h4><dl>{#each game.outcome_metrics as metric}<dt>{metric.name} ({metric.unit})</dt><dd>{current.outcomes[metric.id]}</dd>{/each}</dl>
    <ChartArtifact artifact={timeline} />
    <details><summary>Accessible choice timeline table</summary><div class="table-wrap"><table><thead><tr><th>{sequential ? 'Round' : 'Profile'}</th>{#each game.actors as actor}<th>{actor.name}</th>{/each}</tr></thead><tbody>{#each frames as row, index}<tr><th>{index + 1}</th>{#each game.actors as actor}<td>{game.strategies.find(s => s.id === row.profile[actor.id])?.name} · payoff {row.payoffs[actor.id]}</td>{/each}</tr>{/each}</tbody></table></div></details>
  {:else}<p>No calculated states to visualise. Read the engine’s explanation above: no pure equilibrium or unsupported information structure can leave this view empty.</p>{/if}
</section>
<style>
  .replay { border-block: 2px solid var(--line-strong); padding-block: 1rem; margin-block: 1rem; min-width: 0; } .controls { align-items: center; } .controls, .readout { display: flex; flex-wrap: wrap; gap: 1rem; } .readout { background: var(--text-primary); color: var(--bg); padding: 1rem; } .readout article { flex: 1; min-width: min(100%, 220px); } .readout h4 { color: inherit; } .readout p { color: inherit; } .table-wrap { overflow-x: auto; } th, td { border-bottom: 1px solid var(--line); padding: .5rem; text-align: left; } dt { font-weight: bold; } dd { margin: 0 0 1rem; } input { width: 100%; }
</style>
