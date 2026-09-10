<script lang="ts">
  // ONE PERSONA — the standing dossier, and everything it was built from.
  //
  // Two things are kept visibly apart, because collapsing them is how a library
  // like this quietly goes wrong. The DOSSIER is cumulative and each trait says
  // where it came from and how sure anyone was. The OBSERVATIONS are what each
  // assessment established on its own — the rows that survive if another
  // assessment is deleted, and the only place a contradiction between two papers
  // can be seen as a contradiction rather than averaged into prose.
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import { BAND_FILL, BAND_LABEL } from '$lib/policy-analysis/view';
  import type { Band } from '$lib/policy-analysis/view';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let message = $state('');
  let confirmDelete = $state(false);

  const assessments = $derived(data.observations.filter((o) => o.kind === 'assessment'));
  const notes = $derived(data.observations.filter((o) => o.kind === 'research'));
  const record = $derived(
    assessments
      .flatMap((o) => o.plays.map((play) => ({ ...play, policy: o.analysisTitle, analysisId: o.analysisId })))
      .sort((a, b) => b.exposure - a.exposure),
  );
  const divergent = $derived(assessments.filter((o) => o.note));

  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : 'not recorded');
  const pct = (v: number | null) => (v === null ? 'unstated' : `${Math.round(v * 100)}%`);

  async function research() {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/personas/${data.persona.id}/research`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) { message = body.error ?? 'The research pass could not be completed.'; return; }
      message = `Read ${body.sources} public ${body.sources === 1 ? 'source' : 'sources'} and recorded ${body.traits} ${body.traits === 1 ? 'trait' : 'traits'}.`;
      await invalidateAll();
    } catch { message = 'Connection interrupted. Refresh to see whether the research pass was saved.'; }
    finally { busy = false; }
  }

  async function destroy() {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/personas/${data.persona.id}`, { method: 'DELETE' });
      if (!response.ok) { message = 'Could not delete this persona.'; return; }
      window.location.href = '/policy-analysis/personas';
    } catch { message = 'Connection interrupted. The persona may not have been deleted.'; }
    finally { busy = false; }
  }
</script>

<svelte:head><title>{data.persona.name} — Persona</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<a href="/policy-analysis/personas">← Persona library</a>
<p class="eyebrow">{data.persona.entityType.replaceAll('_', ' ')} · seen in {data.persona.sightings} {data.persona.sightings === 1 ? 'assessment' : 'assessments'}</p>
<h1>{data.persona.name}</h1>
{#if data.persona.aliases.length}<p class="muted">Also recorded as {data.persona.aliases.join(', ')}.</p>{/if}
<p class="standfirst">{data.persona.summary ?? 'No standing description has been written for this body yet. It gains one the next time an assessment names it, or from a research pass.'}</p>

<div class="toolbar">
  <button class="nm-save-btn" disabled={busy} onclick={research}>{busy ? 'Reading public sources…' : 'Commission research'}</button>
  <span class="muted">Last researched {fmt(data.persona.researchedAt)} · dossier updated {fmt(data.persona.updatedAt)}</span>
</div>
<p class="muted">
  A research pass plans a few bounded public search queries about this body — its powers, who it answers to,
  its capacity, its track record — retrieves what it can, and records what the sources establish as its own
  observation. It never touches a policy document, and it spends, which is why it happens on your say-so
  rather than on every run.
</p>
{#if message}<p class="warning" role="status">{message}</p>{/if}

<section class="section">
  <p class="kicker">What we hold</p>
  <h2>The standing dossier</h2>
  <p class="strap">
    Twelve traits chosen because they survive a change of policy. Each says where it came from: a policy
    document that stated it, a public source that established it, or an inference somebody drew. A trait
    carried from an earlier assessment and never confirmed since says exactly that.
  </p>
  {#if data.persona.dossier.length}
    <dl class="dossier">
      {#each data.persona.dossier as trait (trait.key)}
        <div class="trait">
          <dt>{trait.label}</dt>
          <dd>
            <p>{trait.value}</p>
            <p class="muted">{trait.origin.replaceAll('_', ' ')} · confidence {pct(trait.confidence)}</p>
          </dd>
        </div>
      {/each}
    </dl>
  {:else}
    <p class="muted">Nothing has been established about this body yet.</p>
  {/if}
</section>

<section class="section">
  <p class="kicker">What it has been shown to do</p>
  <h2>Track record</h2>
  <p class="strap">
    Exploitation plays found for this body in your assessments, worst first. The next red team is shown
    these as a prompt for what to test — never as a claim about the policy in front of it.
  </p>
  {#if record.length}
    <table>
      <thead><tr><th scope="col">The play</th><th scope="col">Exposure</th><th scope="col">Legality</th><th scope="col">In</th></tr></thead>
      <tbody>
        {#each record.slice(0, 30) as play, i (`${play.analysisId}-${i}`)}
          <tr>
            <td>{play.label}</td>
            <td><span class="band" style="background: {BAND_FILL[play.band as Band] ?? 'transparent'}" class:on-dark={play.band === 'severe'}>{BAND_LABEL[play.band as Band] ?? play.band}</span> {Math.round(play.exposure * 100)}%</td>
            <td>{play.legality}</td>
            <td>{#if play.analysisId}<a href={`/policy-analysis/${play.analysisId}`}>{play.policy ?? 'an assessment'}</a>{:else}{play.policy ?? 'an assessment'}{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if record.length > 30}<p class="muted">and {record.length - 30} more</p>{/if}
  {:else}
    <p class="muted">No exploitation play has been recorded against this body. That is a fact about the assessments so far, not a guarantee about the body.</p>
  {/if}
</section>

{#if divergent.length}
  <section class="section">
    <p class="kicker">Where the papers disagree</p>
    <h2>Continuity and divergence</h2>
    <p class="strap">
      What each assessment added, and — the line worth reading — where a policy's own evidence contradicted
      what the library already held. A body behaving differently under one paper than under another is a
      finding, not noise to be averaged away.
    </p>
    {#each divergent as o (o.id)}
      <div class="ruled">
        <strong>{o.analysisTitle ?? 'An assessment'}</strong>
        <p class="muted">{fmt(o.observedAt)}</p>
        <p class="note">{o.note}</p>
        {#if o.analysisId}<a href={`/policy-analysis/${o.analysisId}`}>Open that assessment →</a>{/if}
      </div>
    {/each}
  </section>
{/if}

{#if notes.length}
  <section class="section">
    <p class="kicker">Commissioned research</p>
    <h2>What public sources say</h2>
    {#each notes as note (note.id)}
      <div class="ruled">
        <p class="muted">{fmt(note.observedAt)}</p>
        {#if note.note}<p>{note.note}</p>{/if}
        {#if note.traits.length}
          <ul class="found">
            {#each note.traits as t (t.key)}<li><strong>{t.label}.</strong> {t.value}</li>{/each}
          </ul>
        {/if}
        {#if note.sources.length}
          <p class="muted">Sources</p>
          <ul class="sources">
            {#each note.sources as source (source.url)}
              <li><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> <span class="muted">· {source.quality}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<section class="section">
  <p class="kicker">Where it came from</p>
  <h2>{data.analyses.length} {data.analyses.length === 1 ? 'assessment' : 'assessments'}</h2>
  <ul class="analyses">
    {#each data.analyses as analysis (analysis.id)}
      <li>
        <a href={`/policy-analysis/${analysis.id}`}>{analysis.title}</a>
        <span class="muted">{analysis.policyArea ?? 'policy area not specified'} · {analysis.status.replaceAll('_', ' ')}</span>
      </li>
    {:else}
      <li class="muted">Every assessment that met this body has since been deleted. The dossier remains; its sightings do not.</li>
    {/each}
  </ul>

  <div class="danger">
    <p class="sr-label">Remove it</p>
    <p class="muted">Deletes this dossier and everything observed about it. The assessments themselves are untouched, and a future run would open a fresh persona for the same body.</p>
    {#if confirmDelete}
      <div class="toolbar">
        <button class="nm-save-btn" disabled={busy} onclick={destroy}>Yes, delete “{data.persona.name}” permanently</button>
        <button class="link" onclick={() => (confirmDelete = false)}>Keep it</button>
      </div>
    {:else}
      <button class="link" onclick={() => (confirmDelete = true)}>Delete this persona</button>
    {/if}
  </div>
</section>

<style>
  .standfirst { max-width: 74ch; }
  .section { border-top: 1px solid var(--line-strong); padding-top: 1.5rem; margin-top: 2.5rem; }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); margin: 0; }
  .strap { color: var(--text-secondary); max-width: 72ch; }
  .dossier { display: grid; gap: 1px; background: var(--line); border: 1px solid var(--line); margin-top: 1.25rem; }
  .trait { background: var(--bg); padding: .9rem 1.1rem; display: grid; grid-template-columns: minmax(10rem, 16rem) minmax(0, 1fr); gap: 1rem; }
  @media (max-width: 720px) { .trait { grid-template-columns: 1fr; gap: .25rem; } }
  dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  dd { margin: 0; }
  dd p { margin: 0 0 .3rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1.25rem; font-size: var(--fs-label); }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .band { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; padding: .1rem .35rem; }
  .band.on-dark { color: var(--bg); }
  .note { border-left: 2px solid var(--accent); padding-left: .8rem; max-width: 74ch; }
  .found, .sources, .analyses { list-style: none; padding: 0; margin: .6rem 0 0; display: grid; gap: .45rem; }
  .found li, .analyses li { max-width: 74ch; }
  .danger { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent); padding: 1rem 1.2rem; margin-top: 2rem; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .4rem; }
  .link { font: inherit; background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; }
</style>
