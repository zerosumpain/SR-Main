<script lang="ts">
  // ARCHITECTURE — the four archetypes (interactive explorer), the precedent gallery,
  // and the today-vs-spine data-flow diagram.
  import { app } from '../lib/appState.svelte';
  import { ARCHETYPES, ARCHETYPE_META, PRECEDENTS, FLOW_TODAY, FLOW_SPINE, type ArchetypeId } from '../lib/precedents';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let arch = $state<ArchetypeId>('locator');
  const archetype = $derived(ARCHETYPES.find((a) => a.id === arch)!);
  const archPrecedents = $derived(PRECEDENTS.filter((p) => p.archetype === arch));
  let flowMode = $state<'today' | 'spine'>('today');
  const flow = $derived(flowMode === 'today' ? FLOW_TODAY : FLOW_SPINE);

  const FATE_META = {
    live: { label: 'Live', color: '#2f7d4f' },
    dead: { label: 'Dead', color: '#8a2d3a' },
    cautionary: { label: 'Cautionary', color: '#b0892a' },
  } as const;
</script>

<svelte:head>
  <title>The Data Spine — four ways to build one</title>
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Architecture"
    title="Four ways to build a spine"
    thesis="“Data spine” could mean anything from a giant central database to no database at all. Other countries and other departments have built all four possible shapes — so the design argument doesn't have to be theoretical. The empirical record is strikingly consistent: pointers survive, warehouses die."
    thesisEli5="There are basically four blueprints, and other governments have tried them all. The big-database one keeps failing; the phone-book one keeps working."
    asks={[
      'The four archetypes: central store, index + locator, federated exchange, identifier-led',
      'Eight precedents from the NHS, Estonia, the Nordics, Australasia — and England itself',
      'How education data flows today vs how it could flow with a spine',
    ]}
    askLabel="What this section covers" />

  <!-- Archetype explorer -->
  <StorySection title="The archetype explorer">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Tap the four blueprints. Each card shows how it works, what it's good and bad at, and what actually happened when
          somebody built it.
        {:else}
          The custody question — <b>connect or collect</b> — is the single biggest open decision about the spine, and it remains
          entirely undecided. These four archetypes map the option space. The SUI pilots' published pattern (a federated record-locator)
          suggests the department's instinct is archetype 2; the white paper's language commits to nothing.
        {/if}
      </p>
      <div class="arch-tabs">
        {#each ARCHETYPES as a}
          <button class="arch-tab" class:on={arch === a.id} style:--ac={ARCHETYPE_META[a.id].color} onclick={() => (arch = a.id)}>
            <span class="at-no">{a.no}</span>{a.name}
          </button>
        {/each}
      </div>
    {/snippet}
    {#snippet data()}
      <div class="arch-detail" style:--ac={ARCHETYPE_META[arch].color}>
        <div class="ad-head">
          <h3>{archetype.name}</h3>
          <span class="ad-short">{archetype.short}</span>
        </div>
        <p class="ad-how">{eli ? archetype.eli5 : archetype.how}</p>
        {#if !eli}
          <div class="ad-cols">
            <div>
              <span class="ad-lab good">Strengths</span>
              <ul>{#each archetype.strengths as s}<li>{s}</li>{/each}</ul>
            </div>
            <div>
              <span class="ad-lab bad">Weaknesses</span>
              <ul>{#each archetype.weaknesses as w}<li>{w}</li>{/each}</ul>
            </div>
          </div>
        {/if}
        <div class="ad-record">
          <span class="ad-lab">The record</span>
          <p>{archetype.record}</p>
        </div>
        {#if archPrecedents.length}
          <div class="ad-precs">
            <span class="ad-lab">Built this way:</span>
            {#each archPrecedents as p}<span class="ad-prec">{p.name}</span>{/each}
          </div>
        {/if}
      </div>
    {/snippet}
  </StorySection>

  <!-- Precedent gallery -->
  <h2 class="pe-h2">The precedent gallery</h2>
  <p class="pe-prose gallery-intro">
    {#if eli}
      Eight real systems, colour-coded by blueprint. Two of them are England's own — already running.
    {:else}
      Eight systems that already answer parts of the spine question — including two live English vertebrae the DfE has
      quietly built while the white paper was being written. Each card ends with the lesson it lends the consultation.
    {/if}
  </p>
  <div class="ds-grid">
    {#each PRECEDENTS as p}
      <div class="ds-card prec-card" style:--ac={ARCHETYPE_META[p.archetype].color}>
        <div class="prec-head">
          <span class="ds-kicker">{p.where}</span>
          <span class="prec-fate" style="color:{FATE_META[p.fate].color}; border-color:{FATE_META[p.fate].color}">{FATE_META[p.fate].label}</span>
        </div>
        <h3>{p.name}</h3>
        <span class="prec-arch">{ARCHETYPE_META[p.archetype].label}</span>
        <p class="ds-body">{eli ? p.eli5 : p.what}</p>
        {#if !eli}<p class="ds-body prec-scale"><b>Scale:</b> {p.scale}</p>{/if}
        <p class="ds-body prec-lesson"><b>Lesson:</b> {p.lesson}</p>
        <a class="prec-link" href={p.url} target="_blank" rel="noopener">source ↗</a>
      </div>
    {/each}
  </div>

  <!-- Flow diagram -->
  <StorySection title="The plumbing, before and after">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Today's route is slow and form-shaped, with private companies already carrying much of the load. Flip the toggle to
          see the promised version — noting that the promised version is a hypothesis, because nothing has been designed.
        {:else}
          Today's flow is the accumulated sediment of twenty years of statutory returns — plus a commercial API layer that already
          moves more data, faster, than the official routes. The “with a spine” view renders the <b>locator hypothesis</b>
          (the shape the SUI pilots point to); a central-store spine would look different and worse. Note who appears in both
          diagrams: the brokers.
        {/if}
      </p>
      <div class="flow-toggle">
        <button class:on={flowMode === 'today'} onclick={() => (flowMode = 'today')}>Today</button>
        <button class:on={flowMode === 'spine'} onclick={() => (flowMode = 'spine')}>With a spine</button>
      </div>
    {/snippet}
    {#snippet data()}
      <div class="flow" class:future={flowMode === 'spine'}>
        {#each flow as stage, i}
          <div class="flow-stage">
            <span class="fs-title">{stage.title}</span>
            <div class="fs-nodes">
              {#each stage.nodes as n}
                <div class="fs-node"><b>{n.label}</b>{#if n.sub}<span>{n.sub}</span>{/if}</div>
              {/each}
            </div>
            <p class="fs-note">{stage.note}</p>
          </div>
          {#if i < flow.length - 1}<div class="flow-arrow" aria-hidden="true">↓</div>{/if}
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <div class="next-row">
    <a class="pe-next" href="/projects/data-spine/governance">Next: the part nobody has designed — governance →</a>
  </div>
</div>

<style>
  .arch-tabs { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .arch-tab { display: flex; align-items: center; gap: 9px; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 500;
    color: var(--ink); background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 8px 13px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  .arch-tab:hover { border-color: var(--ac); }
  .arch-tab.on { border: 1.5px solid var(--ac); background: rgba(255,255,255,0.75); }
  .at-no { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: #fff; background: var(--ac); border-radius: var(--radius-pill); width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 18px; }

  .arch-detail { border: 1.5px solid var(--ac); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 16px 18px; }
  .ad-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .ad-head h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; margin: 0; }
  .ad-short { font-size: 13px; font-style: italic; color: rgba(28,22,17,0.6); }
  .ad-how { font-size: 14px; line-height: 1.6; color: rgba(28,22,17,0.74); margin: 8px 0 12px; }
  .ad-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 12px; }
  .ad-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 4px; }
  .ad-lab.good { color: #2f7d4f; } .ad-lab.bad { color: #8a2d3a; }
  .ad-cols ul { margin: 0; padding-left: 17px; }
  .ad-cols li { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.72); margin-bottom: 3px; }
  .ad-record { border-left: 3px solid var(--ac); background: rgba(28,22,17,0.03); border-radius: var(--radius-round); padding: 9px 13px; }
  .ad-record p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0; }
  .ad-precs { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; margin-top: 10px; }
  .ad-prec { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ink); background: rgba(28,22,17,0.06); border-radius: var(--radius-round); padding: 2px 8px; }
  @media (max-width: 700px) { .ad-cols { grid-template-columns: 1fr; } }

  .gallery-intro { max-width: 84ch; }
  .prec-card { border-top: 3px solid var(--ac); display: flex; flex-direction: column; }
  .prec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .prec-fate { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid; border-radius: var(--radius-round); padding: 0 5px; }
  .prec-arch { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ac); margin-bottom: 2px; }
  .prec-scale, .prec-lesson { margin-top: 6px; }
  .prec-link { margin-top: auto; padding-top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; }

  .flow-toggle { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-round); border: 1px solid rgba(28,22,17,0.12); margin-top: 8px; }
  .flow-toggle button { background: transparent; border: none; color: var(--ink); padding: 6px 14px; border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 11px; cursor: pointer; }
  .flow-toggle button.on { background: var(--accent-ink); color: #fff; }

  .flow { display: flex; flex-direction: column; border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); padding: 16px 18px; }
  .flow.future { border-color: var(--accent-ink-tint-35); background: var(--accent-ink-tint-06); }
  .flow-stage { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 4px 16px; align-items: start; }
  .fs-title { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); padding-top: 8px; }
  .fs-nodes { display: flex; gap: 8px; flex-wrap: wrap; }
  .fs-node { border: 1px solid rgba(28,22,17,0.25); border-radius: var(--radius-round); background: rgba(255,255,255,0.75); padding: 7px 12px; }
  .fs-node b { display: block; font-size: 13px; font-family: 'DM Sans', sans-serif; }
  .fs-node span { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.55); }
  .fs-note { grid-column: 2; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); margin: 4px 0 0; font-style: italic; }
  .flow-arrow { text-align: center; color: rgba(28,22,17,0.4); font-size: 15px; padding: 4px 0; margin-left: 126px; }
  @media (max-width: 640px) {
    .flow-stage { grid-template-columns: 1fr; }
    .fs-note { grid-column: 1; }
    .flow-arrow { margin-left: 0; }
  }

  .next-row { margin: 26px 0 16px; }
</style>
