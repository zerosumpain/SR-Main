<script lang="ts">
  // VALUE & PERSONAS — the interactive core: eight stakeholder lenses, the pro/con
  // value ledger filtered by lens, and the operational-shift story.
  import { app } from '../lib/appState.svelte';
  import { PERSONAS, PERSONA_META } from '../lib/personas';
  import { LEDGER } from '../lib/valueLedger';
  import { SERVICES, OPERATIONAL_SHIFT } from '../lib/operational';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';

  const eli = $derived(app.narrative === 'eli5');
  const selected = $derived(app.persona ? PERSONAS.find((p) => p.id === app.persona) ?? null : null);
  const pros = $derived(LEDGER.filter((e) => e.side === 'pro' && (!app.persona || e.personas.includes(app.persona))));
  const cons = $derived(LEDGER.filter((e) => e.side === 'con' && (!app.persona || e.personas.includes(app.persona))));

  const STATUS_META: Record<string, { label: string; color: string }> = {
    live: { label: 'Live', color: '#2f7d4f' },
    'rolling-out': { label: 'Rolling out', color: 'var(--accent-ink)' },
    legislated: { label: 'Legislated', color: '#7a5aa6' },
    proposed: { label: 'Proposed', color: '#b0892a' },
  };
</script>

<svelte:head>
  <title>The Data Spine — value, pros & cons, eight personas</title>
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Value & personas"
    title="What is it worth — and to whom?"
    thesis="Infrastructure has no value in the abstract: it is worth different things to a trust data lead, a MASH duty officer, a researcher and a parent — and it threatens them differently too. Pick a lens and watch the ledger of benefits and risks rearrange itself."
    thesisEli5="Whether the spine is a good idea depends on where you sit. Pick a character below and see the pros and cons through their eyes."
    asks={[
      'The claimed benefits and the real risks, each marked FACT / HYPOTHESIS / CONTESTED',
      'Eight stakeholder perspectives — what each wants, fears, and would build',
      'Why the DfE needs this now: the shift from policy department to operational department',
    ]}
    askLabel="What this section covers" />

  <!-- Persona lens picker -->
  <div class="lens-bar">
    <span class="lens-lab">View through a lens</span>
    <div class="lens-chips">
      <button class="chip" class:on={app.persona === null} onclick={() => (app.persona = null)}>All perspectives</button>
      {#each PERSONAS as p}
        <button class="chip" class:on={app.persona === p.id} onclick={() => (app.persona = app.persona === p.id ? null : p.id)}>{p.label}</button>
      {/each}
    </div>
  </div>

  {#if selected}
    <div class="persona-card">
      <div class="pc-head">
        <span class="ds-kicker">Perspective · {PERSONA_META[selected.id].short}</span>
        <h2>{selected.label}</h2>
        <p class="pc-who">{selected.who}</p>
      </div>
      <p class="pc-stake"><b>The stake:</b> {selected.stake}</p>
      <div class="pc-cols">
        <div class="pc-col">
          <span class="pc-col-lab want">▲ Wants</span>
          <ul>{#each selected.wants as w}<li>{w}</li>{/each}</ul>
        </div>
        <div class="pc-col">
          <span class="pc-col-lab fear">▼ Fears</span>
          <ul>{#each selected.fears as f}<li>{f}</li>{/each}</ul>
        </div>
      </div>
      <p class="pc-spine"><b>The spine they'd build:</b> {selected.spineTheyWant}</p>
      <blockquote class="pc-verdict">
        <p>{eli ? selected.eli5 : selected.verdict}</p>
        <footer>Composite view — grounded in: {selected.grounding}</footer>
      </blockquote>
    </div>
  {:else}
    <div class="ds-grid persona-grid">
      {#each PERSONAS as p}
        <button class="ds-card persona-mini" onclick={() => (app.persona = p.id)}>
          <span class="ds-kicker">{PERSONA_META[p.id].short}</span>
          <h3>{p.label}</h3>
          <p class="ds-body">{p.spineTheyWant}</p>
          <span class="mini-more">Read their view →</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Value ledger -->
  <StorySection title={selected ? `The ledger, as ${selected.label} reads it` : 'The value ledger'}>
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Green side: what the spine could give. Red side: what it could cost. The badges say how solid each claim is —
          plenty here is honest guesswork, because the thing hasn't been designed yet.
        {:else}
          Each entry carries its evidence and a confidence mark. Note the asymmetry the ledger reveals: the <b>benefits</b> are
          mostly demonstrated in miniature (the attendance feed, the Education Record, FSM pilots) but depend on delivery;
          the <b>risks</b> are mostly documented history (the audit, the MoU, ContactPoint) and depend on design.
          {#if selected}Showing only entries that land on <b>{selected.label}</b> — clear the lens for the full ledger.{/if}
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="ledger">
        <div class="ledger-col">
          <span class="ledger-lab pro">Claimed benefits · {pros.length}</span>
          {#each pros as e (e.id)}
            <div class="entry pro">
              <div class="entry-head"><b>{e.title}</b><ConfidenceBadge level={e.confidence} small /></div>
              <p>{eli ? e.eli5 : e.detail}</p>
              <div class="entry-foot">
                <span class="entry-personas">{e.personas.map((p) => PERSONA_META[p].short).join(' · ')}</span>
                {#if e.sourceUrl}<a href={e.sourceUrl} target="_blank" rel="noopener">source ↗</a>{/if}
              </div>
            </div>
          {/each}
        </div>
        <div class="ledger-col">
          <span class="ledger-lab con">Risks & costs · {cons.length}</span>
          {#each cons as e (e.id)}
            <div class="entry con">
              <div class="entry-head"><b>{e.title}</b><ConfidenceBadge level={e.confidence} small /></div>
              <p>{eli ? e.eli5 : e.detail}</p>
              <div class="entry-foot">
                <span class="entry-personas">{e.personas.map((p) => PERSONA_META[p].short).join(' · ')}</span>
                {#if e.sourceUrl}<a href={e.sourceUrl} target="_blank" rel="noopener">source ↗</a>{/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/snippet}
  </StorySection>

  <!-- Operational shift -->
  <StorySection title="Why now: the operational turn">
    {#snippet prose()}
      {#if eli}
        <p class="pe-prose">{OPERATIONAL_SHIFT.eli5}</p>
      {:else}
        {#each OPERATIONAL_SHIFT.prose as p}<p class="pe-prose">{p}</p>{/each}
      {/if}
      <p class="pe-prose"><ConfidenceBadge level={OPERATIONAL_SHIFT.confidence} note="An interpretive reading — the services are facts; the framing is this project's." /></p>
    {/snippet}
    {#snippet data()}
      <div class="services">
        {#each SERVICES as s}
          <div class="svc">
            <div class="svc-head">
              <b>{s.name}</b>
              <span class="svc-status" style="color:{STATUS_META[s.status].color}; border-color:{STATUS_META[s.status].color}">{STATUS_META[s.status].label}</span>
              <span class="svc-cadence">{s.cadence}</span>
            </div>
            <p>{eli ? s.eli5 : s.what}</p>
            {#if !eli}<p class="svc-role"><b>Spine role:</b> {s.spineRole}</p>{/if}
            {#if s.url}<a class="svc-link" href={s.url} target="_blank" rel="noopener">source ↗</a>{/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <div class="next-row">
    <a class="pe-next" href="/projects/data-spine/architecture">Next: four ways to build a spine →</a>
  </div>
</div>

<style>
  .lens-bar { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin: 4px 0 16px; }
  .lens-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.12em; color: rgba(28,22,17,0.5); }
  .lens-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 500; color: var(--ink); background: rgba(255,255,255,0.55);
    border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round); padding: 5px 12px; cursor: pointer; transition: background 0.12s, color 0.12s; }
  .chip:hover { background: rgba(28,22,17,0.08); }
  .chip.on { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink); }

  .persona-grid .persona-mini { text-align: left; cursor: pointer; font: inherit; transition: border-color 0.12s, background 0.12s; }
  .persona-mini:hover { border-color: var(--accent-ink); background: var(--accent-ink-tint-06); }
  .mini-more { display: inline-block; margin-top: 8px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent-ink); }

  .persona-card { border: 1.5px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 18px 20px; margin: 0 0 8px; }
  .pc-head h2 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; margin: 2px 0 4px; }
  .pc-who { font-size: 13.5px; color: rgba(28,22,17,0.65); margin: 0 0 10px; max-width: 84ch; }
  .pc-stake { font-size: 14px; line-height: 1.6; color: rgba(28,22,17,0.74); margin: 0 0 12px; max-width: 84ch; }
  .pc-stake b, .pc-spine b { color: var(--ink); }
  .pc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 0 0 12px; }
  .pc-col-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 5px; }
  .pc-col-lab.want { color: #2f7d4f; } .pc-col-lab.fear { color: #8a2d3a; }
  .pc-col ul { margin: 0; padding-left: 18px; }
  .pc-col li { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin-bottom: 4px; }
  .pc-spine { font-size: 14px; color: rgba(28,22,17,0.74); margin: 0 0 12px; }
  .pc-verdict { margin: 0; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-06); border-radius: var(--radius-round); padding: 12px 16px; }
  .pc-verdict p { font-family: 'Fraunces', serif; font-size: 15.5px; line-height: 1.6; color: var(--ink); margin: 0 0 8px; }
  .pc-verdict footer { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  @media (max-width: 700px) { .pc-cols { grid-template-columns: 1fr; } }

  .ledger { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .ledger-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }
  .ledger-lab.pro { color: #2f7d4f; } .ledger-lab.con { color: #8a2d3a; }
  .entry { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 11px 13px; margin-bottom: 10px; }
  .entry.pro { border-left: 3px solid #2f7d4f; }
  .entry.con { border-left: 3px solid #8a2d3a; }
  .entry-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .entry-head b { font-family: 'Fraunces', serif; font-size: 14.5px; }
  .entry p { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72); margin: 5px 0 6px; }
  .entry-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .entry-personas { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.45); }
  .entry-foot a { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; white-space: nowrap; }
  @media (max-width: 860px) { .ledger { grid-template-columns: 1fr; } }

  .services { display: flex; flex-direction: column; gap: 12px; }
  .svc { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 15px; }
  .svc-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .svc-head b { font-family: 'Fraunces', serif; font-size: 15.5px; }
  .svc-status { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid; border-radius: var(--radius-round); padding: 1px 6px; }
  .svc-cadence { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); margin-left: auto; }
  .svc p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.72); margin: 6px 0 0; }
  .svc-role b { color: var(--ink); }
  .svc-link { display: inline-block; margin-top: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .next-row { margin: 26px 0 16px; }
</style>
