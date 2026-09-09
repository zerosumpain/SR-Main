<script lang="ts">
  // One exploitation play, written for someone who has to decide whether to
  // change the policy before it goes out.
  //
  // The four factor bars are the whole ranking, shown rather than asserted: the
  // reader can see that a play scored high because it is easy and invisible, not
  // because a model called it dangerous. `counter` is deliberately the last line
  // and never hidden behind a disclosure — a weakness with no answer beside it
  // reads as an accusation.
  import type { Play } from '$lib/policy-analysis/view';
  import { BAND_FILL, BAND_LABEL, FACTOR_KEYS } from '$lib/policy-analysis/view';
  import { EXPOSURE_FACTORS } from '$lib/policy-analysis/exposure';

  interface Props {
    play: Play;
    rank: number;
    inspect: (id: string) => void;
  }

  let { play, rank, inspect }: Props = $props();
  const data = $derived(play.artefact.data as Record<string, string>);
  const legality = $derived(String(data.legality ?? ''));
  const describe = (key: string) => EXPOSURE_FACTORS.find(([k]) => k === key)?.[1] ?? key;
</script>

<article class="play">
  <header>
    <span class="rank">{rank}</span>
    <div class="title">
      <h3>{play.artefact.label}</h3>
      <p class="who">{play.actor?.label ?? 'Actor unresolved'}</p>
    </div>
    <span class="band" style="background: {BAND_FILL[play.band]}" class:on-dark={play.band === 'severe'}>
      {BAND_LABEL[play.band]} · {Math.round(play.exposure * 100)}
    </span>
  </header>

  <p class="statement">{play.artefact.statement}</p>

  {#if legality}
    <p class="legality" class:compliant={legality === 'compliant'}>
      {legality === 'compliant' ? 'Stays within the rules as written' : legality === 'grey' ? 'Arguable either way' : 'Would be a breach'}
      {#if legality === 'compliant'}<span class="muted"> — which is what makes it hard to answer.</span>{/if}
    </p>
  {/if}

  <dl class="factors">
    {#each FACTOR_KEYS as key (key)}
      {@const value = play.factors.find((f) => f.key === key)?.value ?? 0}
      <div class="factor">
        <dt>{key}</dt>
        <dd>
          <span class="track"><span class="fill" style="width: {Math.round(value * 100)}%"></span></span>
          <span class="pct">{Math.round(value * 100)}</span>
        </dd>
        <p class="muted">{describe(key)}</p>
      </div>
    {/each}
  </dl>

  <div class="lines">
    {#if data.payoff}<p><strong>What they get.</strong> {data.payoff}</p>{/if}
    {#if data.costToPolicy}<p><strong>What it costs the policy.</strong> {data.costToPolicy}</p>{/if}
    {#if data.earlyWarning}<p><strong>First sign of it.</strong> {data.earlyWarning}</p>{/if}
    {#if data.precedent}<p class="muted"><strong>Precedent.</strong> {data.precedent}</p>{/if}
  </div>

  {#if data.counter}
    <p class="counter"><strong>What would close it.</strong> {data.counter}</p>
  {/if}

  <button class="trace" onclick={() => inspect(play.artefact.id)}>
    Motivation, preconditions and evidence ({play.artefact.refs.length}) →
  </button>
</article>

<style>
  .play { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: 1.1rem 1.25rem; background: var(--bg); }
  header { display: flex; gap: .9rem; align-items: start; }
  .rank { font-family: var(--font-display); font-size: 1.6rem; line-height: 1; color: var(--text-ghost, var(--text-muted)); flex: none; }
  .title { flex: 1 1 auto; min-width: 0; }
  h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: 0; }
  .who { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-ink); margin: .25rem 0 0; }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .3rem .5rem; flex: none; align-self: flex-start; }
  .band.on-dark { color: var(--bg); }
  .statement { margin: .8rem 0 0; }
  .legality { margin: .6rem 0 0; font-size: var(--fs-label); font-weight: 600; }
  .legality.compliant { color: var(--accent); }
  .factors { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .9rem 1.25rem; margin: 1.1rem 0 0; }
  .factor dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .factor dd { margin: .3rem 0 .25rem; display: flex; align-items: center; gap: .5rem; }
  .track { flex: 1 1 auto; height: .5rem; background: var(--surface-sunken); border: 1px solid var(--line); }
  .fill { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; }
  .pct { font-family: var(--font-mono); font-size: var(--fs-label); flex: none; }
  .lines { margin-top: 1rem; display: grid; gap: .45rem; }
  .lines p { margin: 0; }
  .counter { margin: .9rem 0 0; background: var(--surface-sunken); border-left: 2px solid var(--accent-ink); padding: .7rem .9rem; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
  .trace { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: .6rem 0 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; text-align: left; }
</style>
