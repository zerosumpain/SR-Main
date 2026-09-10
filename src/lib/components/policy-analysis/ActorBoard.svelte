<script lang="ts">
  // C — WHO IS IN THE ROOM. One card per profiled actor, ordered by the worst
  // play they could run rather than alphabetically or by how often the paper
  // mentions them.
  //
  // The five fields shown by default are the persona, not the org chart: who
  // they answer to, what they are judged on, how far ahead they can afford to
  // look, what they do instead if they decline, and who is better off if this
  // fails. That last one is the question an assurance review never asks, so it
  // gets its own line and its own emphasis.
  import type { Artefact } from '$lib/policy-analysis/contracts';
  import type { ActorView } from '$lib/policy-analysis/view';
  import { BAND_FILL, BAND_LABEL } from '$lib/policy-analysis/view';

  interface Props {
    actors: ActorView[];
    /**
     * Bodies this assessment met that the reader has met before. Read from the
     * observation rows rather than from the run's own artefacts: a persona minted
     * by THIS run gets its identifier at commit, so the artefact that asked for
     * it carries a null id and could not be followed to a page.
     */
    personas?: { actorId: string | null; personaId: string; name: string; sightings: number }[];
    inspect: (id: string) => void;
  }

  let { actors, personas = [], inspect }: Props = $props();

  const libraryOf = (actorId: string) => personas.find((p) => p.actorId === actorId) ?? null;

  const PERSONA = [
    ['accountableTo', 'Answers to'],
    ['successCriteria', 'Judged on'],
    ['timeHorizon', 'Can look ahead'],
    ['outsideOption', 'Does instead'],
    ['gainFromFailure', 'Better off if it fails'],
  ] as const;

  function field(profile: Artefact | null, key: string): { value: string; origin: string } | null {
    const raw = profile?.data?.[key];
    if (!raw || typeof raw !== 'object') return null;
    const f = raw as { value?: string; origin?: string };
    return f.value ? { value: f.value, origin: String(f.origin ?? '') } : null;
  }
</script>

<div class="board">
  {#each actors as view (view.actor.id)}
    <article class="actor">
      <header>
        <h3 data-pa-peek={`actor:${view.actor.id}`}>{view.actor.label}</h3>
        <p class="type">{String(view.actor.data.entityType ?? '').replaceAll('_', ' ')}</p>
        {#if libraryOf(view.actor.id)}
          {@const known = libraryOf(view.actor.id)}
          <a class="persona" href={`/policy-analysis/personas/${known?.personaId}`}>
            In your library{#if (known?.sightings ?? 0) > 1}{' · '}seen in {known?.sightings} assessments{/if} →
          </a>
        {/if}
      </header>

      {#if view.profile}
        <dl>
          {#each PERSONA as [key, label] (key)}
            {@const f = field(view.profile, key)}
            {#if f}
              <div class="row" class:pointed={key === 'gainFromFailure'}>
                <dt>{label}</dt>
                <dd>{f.value}{#if f.origin && f.origin !== 'extracted_fact'}<span class="origin"> · {f.origin.replaceAll('_', ' ')}</span>{/if}</dd>
              </div>
            {/if}
          {/each}
        </dl>
      {:else}
        <p class="muted">No incentive profile was built for this actor, so its motivations are outside this assessment.</p>
      {/if}

      {#if view.plays.length}
        <ul class="plays">
          {#each view.plays.slice(0, 4) as play (play.artefact.id)}
            <li>
              <span class="band" style="background: {BAND_FILL[play.band]}" class:on-dark={play.band === 'severe'}>{BAND_LABEL[play.band]}</span>
              <button class="play-link" data-pa-peek={`play:${play.artefact.id}`} onclick={() => inspect(play.artefact.id)}>{play.artefact.label}</button>
            </li>
          {/each}
          {#if view.plays.length > 4}<li class="muted">and {view.plays.length - 4} more</li>{/if}
        </ul>
      {:else}
        <p class="muted none">No exploitation play was found for this actor. That is a finding, not a guarantee.</p>
      {/if}

      <button class="trace" onclick={() => inspect(view.profile?.id ?? view.actor.id)}>Full profile and evidence →</button>
    </article>
  {:else}
    <p class="muted">No actor has been profiled yet.</p>
  {/each}
</div>

<style>
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1px; background: var(--line-strong); border: 1px solid var(--line-strong); margin-top: 1.25rem; }
  .actor { background: var(--bg); padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: 0; }
  .persona { display: inline-block; margin-top: .35rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-ink); }
  .type { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-ink); margin: .25rem 0 0; }
  dl { margin: 0; display: grid; gap: .55rem; }
  .row dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .row dd { margin: .15rem 0 0; }
  .row.pointed dd { border-left: 2px solid var(--accent); padding-left: .7rem; }
  .origin { color: var(--text-muted); font-size: var(--fs-label); }
  .plays { list-style: none; padding: 0; margin: 0; display: grid; gap: .4rem; }
  .plays li { display: flex; gap: .5rem; align-items: baseline; }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .15rem .4rem; flex: none; }
  .band.on-dark { color: var(--bg); }
  .play-link { font: inherit; background: none; border: 0; padding: 0; text-align: left; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); margin: 0; }
  .none { border-left: 2px solid var(--line-strong); padding-left: .7rem; }
  .trace { margin-top: auto; font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: .4rem 0 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; text-align: left; }
</style>
