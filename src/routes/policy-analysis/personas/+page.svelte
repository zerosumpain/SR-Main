<script lang="ts">
  // THE PERSONA LIBRARY — the bodies this reader keeps meeting.
  //
  // Every assessment used to derive its actors from scratch and throw them away
  // when the run ended, so the eighth assessment of a department's policy knew
  // nothing the first seven had learned about the department. A persona is what
  // survives: what this body is, what its position rewards, and what it has
  // actually been shown able to do, drawn from every assessment that met it.
  import type { PageData } from './$types';
  import { BAND_FILL, BAND_LABEL } from '$lib/policy-analysis/view';
  import type { Band } from '$lib/policy-analysis/view';

  let { data }: { data: PageData } = $props();

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : 'not recorded');
  const total = $derived(data.personas.reduce((n, p) => n + p.sightings, 0));
</script>
<svelte:head><title>Persona library — Policy analysis</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<!-- One padded container for the whole page, because `.policy-page` is now
     full-bleed: every band on the assessment page paints to the window edge
     and holds its own content to the measure, and a page that is a run of
     loose prose elements wants the container the old wrapper was. -->
<div class="pa-wrap pa-sheet">
  <a href="/policy-analysis">← All policy analyses</a>
  <p class="eyebrow">Actors across assessments</p>
  <h1>The persona library</h1>
  <p class="standfirst">
    Bodies you keep meeting. Each dossier is built from the assessments that named it — what it exists to do,
    what its position rewards, what it can compel, and the plays it has been shown capable of running. A
    persona is context for the next assessment, never evidence in it: a red team that imports last month's
    conclusion about a department has stopped reading this month's policy.
  </p>

  {#if data.personas.length}
    <p class="muted count">{data.personas.length} {data.personas.length === 1 ? 'body' : 'bodies'} across {total} {total === 1 ? 'sighting' : 'sightings'}.</p>
    <div class="library">
      {#each data.personas as persona (persona.id)}
        <article class="persona">
          <header>
            <h2><a href={`/policy-analysis/personas/${persona.id}`}>{persona.name}</a></h2>
            <p class="type">{persona.entityType.replaceAll('_', ' ')}</p>
          </header>
          <p class="summary">{persona.summary ?? 'No standing description has been written for this body yet.'}</p>
          <dl>
            <div><dt>Seen in</dt><dd>{persona.sightings} {persona.sightings === 1 ? 'assessment' : 'assessments'}</dd></div>
            <div><dt>Plays on record</dt><dd>{persona.plays}</dd></div>
            <div>
              <dt>Worst it has run</dt>
              <dd>
                {#if persona.worstBand}
                  <span class="band" style="background: {BAND_FILL[persona.worstBand as Band]}" class:on-dark={persona.worstBand === 'severe'}>{BAND_LABEL[persona.worstBand as Band]}</span>
                {:else}nothing recorded{/if}
              </dd>
            </div>
            <div><dt>Last met</dt><dd>{fmt(persona.lastSeen)}</dd></div>
          </dl>
          {#if persona.researchNotes}<p class="muted">{persona.researchNotes} commissioned research {persona.researchNotes === 1 ? 'pass' : 'passes'}.</p>{/if}
          <a class="open" href={`/policy-analysis/personas/${persona.id}`}>Open the dossier →</a>
        </article>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <p>The library is empty.</p>
      <p class="muted">
        A persona is opened by the last stage of an assessment, once the report is written: every resolved
        actor with an incentive profile is matched against what is already here, and either enriches a
        dossier or starts one. Run an assessment and this fills itself.
      </p>
    </div>
  {/if}
</div>

<style>
  .standfirst { max-width: 70ch; }
  .count { margin-top: 1.5rem; }
  .library { display: grid; grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr)); gap: 1px; background: var(--line-strong); border: 1px solid var(--line-strong); margin-top: .5rem; }
  .persona { background: var(--bg); padding: 1.2rem 1.3rem; display: flex; flex-direction: column; gap: .7rem; min-width: 0; }
  h2 { font-family: var(--font-display); font-size: var(--fs-display-xs); margin: 0; }
  h2 a { text-decoration: none; }
  .type { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-ink); margin: .25rem 0 0; }
  .summary { margin: 0; }
  dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); gap: .6rem; margin: 0; }
  dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  dd { margin: .15rem 0 0; }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .1rem .4rem; }
  .band.on-dark { color: var(--bg); }
  .open { margin-top: auto; font-family: var(--font-mono); font-size: var(--fs-label); }
  .empty { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: 1.5rem; margin-top: 1.5rem; max-width: 70ch; }
  .muted { color: var(--text-muted); font-size: var(--fs-label); }
</style>
