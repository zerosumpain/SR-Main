<script lang="ts">
  // GOVERNANCE — the project's largest section: the trust ledger, the legal plumbing,
  // the privacy-technique catalogue mapped to spine layers, the interactive design
  // playbook, and the closing synthesis.
  import { app } from '../lib/appState.svelte';
  import { TRUST_EVENTS, LEGAL, PETS, PET_LAYER_META, PLAYBOOK, playbookVerdict, SYNTHESIS } from '../lib/governance';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';

  const eli = $derived(app.narrative === 'eli5');

  // playbook selections — default to the "middle" design so the readout starts meaningful
  let picks = $state<Record<string, string>>({ custody: 'locator', identifier: 'nhs', access: 'purpose', transparency: 'register' });
  const maxScore = PLAYBOOK.reduce((s, d) => s + Math.max(...d.options.map((o) => o.score)), 0);
  const score = $derived(PLAYBOOK.reduce((s, d) => s + (d.options.find((o) => o.id === picks[d.id])?.score ?? 0), 0));
  const pct = $derived(Math.round((score / maxScore) * 100));
  const verdict = $derived(playbookVerdict(pct));
  const chosen = $derived(PLAYBOOK.map((d) => ({ d, o: d.options.find((o) => o.id === picks[d.id])! })));
</script>

<svelte:head>
  <title>The Data Spine — governance, privacy and trust</title>
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Governance"
    title="The part nobody has designed"
    thesis="The white paper promises the spine will be “secure and privacy-respecting”. The record — an ICO audit the department failed, a Home Office data-sharing scandal, 2,385 pupil-data distributions, and one universal child database already built and destroyed — is why nobody in the sector takes those adjectives on trust. This section is the project's largest because governance, not plumbing, is where the spine will be won or lost."
    thesisEli5="The government says the spine will respect privacy. Its track record with school data is poor — so this section looks at what actually went wrong before, what the law now says, and the concrete technologies that could make the promise real."
    asks={[
      'The trust ledger: what actually happened to education data, 2009–2025',
      'The legal plumbing: what the CWSA, the DUAA and UK GDPR permit and omit',
      'Nine privacy-preserving techniques, mapped to the five spine layers',
      'The design playbook: make the four big choices and see what you’ve built',
    ]}
    askLabel="What this section covers" />

  <!-- Trust ledger -->
  <StorySection title="The trust ledger">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Five stories explain why parents' groups and doctors are suspicious. None of them is about hackers —
          every one is about permissions: who was allowed in, and who was watching.
        {:else}
          Read the ledger for the pattern, not the outrage: <b>none of these failures was a plumbing failure.</b>
          Data did not leak through broken encryption; it walked out through granted access — a regulation widened,
          a memorandum signed, an account left alive, an audit function that did not exist. That is the empirical case
          for treating the governance layer as the spine's hardest engineering problem.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="trust">
        {#each TRUST_EVENTS as t}
          <div class="tevent">
            <div class="te-head">
              <span class="te-year">{t.year}</span>
              <b>{t.title}</b>
              <ConfidenceBadge level={t.confidence} small />
            </div>
            <p>{eli ? t.eli5 : t.what}</p>
            {#if !eli}<p class="te-why"><b>Why it matters here:</b> {t.why}</p>{/if}
            {#if t.url}<a class="te-link" href={t.url} target="_blank" rel="noopener">source ↗</a>{/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Legal plumbing -->
  <StorySection title="The legal plumbing">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          The law has recently made data sharing easier (a new 2025 Act), created the child identifier (the 2026 Act),
          and still has one big hole: schools' data has no special rulebook the way hospitals' data does.
        {:else}
          Legally, the spine arrives at a permissive moment: the DUAA 2025 lowered the friction on public-body sharing at
          exactly the time the CWSA created the identifier. The countervailing instrument — a statutory code of practice for
          children's education data, health's equivalent of which has existed for decades — is the one piece of plumbing
          that does not exist. Both the campaign literature and the ICO point at that gap.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="legal">
        {#each LEGAL as l}
          <div class="ds-card legal-card">
            <h3>{l.name}</h3>
            <p class="ds-body">{eli ? l.eli5 : l.what}</p>
            {#if !eli}<p class="ds-body"><b>Spine relevance:</b> {l.spineRelevance}</p>{/if}
            {#if l.url}<a class="te-link" href={l.url} target="_blank" rel="noopener">source ↗</a>{/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- PET catalogue -->
  <h2 class="pe-h2">Privacy-preserving technology, layer by layer</h2>
  <p class="pe-prose pet-intro">
    {#if eli}
      Nine real techniques — each tagged with the layer of the spine it protects, and where it's already been used for real.
      Together they answer the question “can this be built safely?” with “yes, and here's how”.
    {:else}
      The honest answer to “can a spine be privacy-preserving?” is that every required technique already runs in production
      somewhere — most of them inside the UK public sector. Each card names the spine layer it defends and its precedent.
      The catalogue's collective lesson: <b>privacy is mostly an architecture choice, not a compliance activity</b> —
      minimise what the centre holds, gate every join, and make every access observable.
    {/if}
  </p>
  <div class="ds-grid">
    {#each PETS as p}
      <div class="ds-card pet-card">
        <div class="pet-head">
          <span class="pet-layer" style="color:{PET_LAYER_META[p.layer].color}; border-color:{PET_LAYER_META[p.layer].color}">{PET_LAYER_META[p.layer].label}</span>
          <span class="pet-maturity" class:emerging={p.maturity === 'emerging'}>{p.maturity}</span>
        </div>
        <h3>{p.name}</h3>
        <p class="ds-body">{eli ? p.eli5 : p.what}</p>
        {#if !eli}<p class="ds-body"><b>Precedent:</b> {p.precedent}</p>{/if}
        {#if p.url}<a class="te-link" href={p.url} target="_blank" rel="noopener">source ↗</a>{/if}
      </div>
    {/each}
  </div>

  <!-- Design playbook -->
  <h2 class="pe-h2">The design playbook</h2>
  <p class="pe-prose pet-intro">
    {#if eli}
      Now you're the architect. Make the four big choices and see what you've built — and how it compares with the systems
      that lived and died before it. The score is a thinking tool, not a measurement.
    {:else}
      Four decisions define the spine's privacy posture. Choose, and the readout composes the consequences from the precedents.
      The trust score is a structured argument, not a measurement — <ConfidenceBadge level="hypothesis" small /> by construction —
      but the ordering it encodes (locator over store, receipts over silence) is the consistent lesson of every precedent in this project.
    {/if}
  </p>
  <div class="playbook">
    <div class="pb-decisions">
      {#each PLAYBOOK as d}
        <div class="pb-decision">
          <div class="pb-q"><span class="pb-no">{d.no}</span><b>{d.title}</b><span class="pb-qq">{d.question}</span></div>
          <div class="pb-opts">
            {#each d.options as o}
              <button class="pb-opt" class:on={picks[d.id] === o.id} onclick={() => (picks = { ...picks, [d.id]: o.id })}>
                <b>{o.label}</b>
                <span>{o.detail}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <div class="pb-readout" data-tone={verdict.tone}>
      <div class="pb-score">
        <span class="pb-score-lab">Trust posture</span>
        <div class="pb-meter"><div class="pb-fill" style="width:{pct}%"></div></div>
        <b class="pb-verdict">{verdict.label}</b>
      </div>
      <p class="pb-verdict-text">{verdict.text}</p>
      <div class="pb-consequences">
        {#each chosen as c}
          <div class="pb-cons">
            <span class="ds-kicker">{c.d.title} → {c.o.label}</span>
            <p>{c.o.consequence}</p>
            <p class="pb-prec">Precedent: {c.o.precedent}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Synthesis -->
  <div class="synthesis">
    <h2 class="pe-h2">{SYNTHESIS.title}</h2>
    {#if eli}
      <p class="pe-prose">{SYNTHESIS.eli5}</p>
    {:else}
      <ol class="syn-list">
        {#each SYNTHESIS.points as p}<li>{p}</li>{/each}
      </ol>
    {/if}
    <p class="pe-prose syn-links">Companions: <a href="/projects/policy-engine/monitor">Policy Engine №4 — how we'd know policy works</a> ·
      <a href="/projects/dfe-data-strategy">Keystone — the department's whole data agenda</a>.</p>
  </div>
</div>

<style>
  .trust { display: flex; flex-direction: column; gap: 12px; }
  .tevent { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 15px; }
  .te-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .te-year { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #8a2d3a; }
  .te-head b { font-family: 'Fraunces', serif; font-size: 15.5px; }
  .tevent p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.72); margin: 6px 0 0; }
  .te-why b { color: var(--ink); }
  .te-link { display: inline-block; margin-top: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .legal { display: flex; flex-direction: column; gap: 12px; }
  .legal-card h3 { font-size: 15px; }

  .pet-intro { max-width: 84ch; }
  .pet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .pet-layer { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid; border-radius: var(--radius-round); padding: 1px 6px; }
  .pet-maturity { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #2f7d4f; }
  .pet-maturity.emerging { color: #b0892a; }

  .playbook { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px; margin: 14px 0 8px; align-items: start; }
  .pb-decisions { display: flex; flex-direction: column; gap: 14px; }
  .pb-decision { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .pb-q { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; margin-bottom: 8px; }
  .pb-no { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #fff; background: var(--ink); border-radius: var(--radius-pill); width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; }
  .pb-q b { font-family: 'Fraunces', serif; font-size: 16px; }
  .pb-qq { font-size: 12.5px; font-style: italic; color: rgba(28,22,17,0.55); }
  .pb-opts { display: flex; flex-direction: column; gap: 6px; }
  .pb-opt { text-align: left; font: inherit; background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-round); padding: 8px 12px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  .pb-opt:hover { border-color: var(--accent-ink); }
  .pb-opt.on { border: 1.5px solid var(--accent-ink); background: var(--accent-ink-tint-06); }
  .pb-opt b { display: block; font-size: 13.5px; font-family: 'DM Sans', sans-serif; color: var(--ink); }
  .pb-opt span { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.62); }

  .pb-readout { position: sticky; top: calc(var(--topH, 0px) + 62px); border: 1.5px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); background: rgba(255,255,255,0.55); padding: 14px 16px; }
  .pb-readout[data-tone='good'] { border-color: #2f7d4f; }
  .pb-readout[data-tone='mid'] { border-color: #b0892a; }
  .pb-readout[data-tone='bad'] { border-color: #8a2d3a; }
  .pb-score-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .pb-meter { height: 8px; border-radius: var(--radius-round); background: rgba(28,22,17,0.09); margin: 7px 0; overflow: hidden; }
  .pb-fill { height: 100%; border-radius: var(--radius-round); background: var(--accent-ink); transition: width 0.25s var(--ease-out); }
  .pb-readout[data-tone='good'] .pb-fill { background: #2f7d4f; }
  .pb-readout[data-tone='mid'] .pb-fill { background: #b0892a; }
  .pb-readout[data-tone='bad'] .pb-fill { background: #8a2d3a; }
  .pb-verdict { font-family: 'Fraunces', serif; font-size: 18px; }
  .pb-verdict-text { font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.74); margin: 8px 0 12px; }
  .pb-cons { border-top: 1px solid rgba(28,22,17,0.1); padding: 9px 0 2px; }
  .pb-cons p { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.72); margin: 4px 0 0; }
  .pb-prec { font-style: italic; color: rgba(28,22,17,0.55) !important; }
  @media (max-width: 940px) {
    .playbook { grid-template-columns: 1fr; }
    .pb-readout { position: static; }
  }

  .synthesis { margin: 30px 0 10px; border: 1.5px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); padding: 6px 22px 16px; }
  .syn-list { margin: 8px 0 0; padding-left: 20px; }
  .syn-list li { font-size: 14.5px; line-height: 1.65; color: rgba(28,22,17,0.78); margin-bottom: 8px; }
  .syn-links { margin-top: 12px; font-size: 13px; }
</style>
