<script lang="ts">
  // SOURCES — the estate & the evidence. The real education data estate this study
  // draws on, as first-class entities (the MIS market with real counts, the DfE's
  // existing stores, the local-authority second world, the identifiers that don't
  // join), plus every citation, promoted out of the footer.
  import { app } from '../lib/appState.svelte';
  import { LAYERS } from '../lib/spine';
  import { SOURCES } from '../lib/sources';
  import {
    SUPPLIERS, STORES, LA_HOLDERS, CROSS_HOLDERS,
    DEFAULT_SCHOOL_COUNT, STATE_CENSUS_TOTAL,
  } from '$lib/sim/federation/topology';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';

  const eli = $derived(app.narrative === 'eli5');
  const gb = (n: number) => n.toLocaleString('en-GB');
  const stateVendors = SUPPLIERS.filter((s) => !s.indicative);
  const tailVendors = SUPPLIERS.filter((s) => s.indicative);
  const top3 = stateVendors.slice(0, 3).reduce((a, s) => a + s.schools, 0);
  const idLayers = LAYERS.filter((l) => l.id === 'identifier' || l.id === 'index');
</script>

<svelte:head>
  <title>The Data Spine — the estate & the evidence</title>
  <meta name="description" content="The real education data estate a data spine would sit on: the English school MIS market with real WhichMIS Oct-2025 counts, the DfE's existing stores (NPD/LEO/ILR/LDS), the 153 local authorities and their case systems, the identifiers that fail to join — and every source this study cites." />
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Sources"
    title="The estate & the evidence"
    thesis="Before arguing about how to connect England's education data, it helps to see what data actually exists and where it lives. This section lays out the real estate — the school MIS market, the department's existing stores, the second world of 153 local authorities, and the identifiers that stubbornly fail to line up — and then every source the study rests on. The figures here are sourced; where they can only be estimated, they say so."
    thesisEli5="What data is there, and where does it sit? This page shows the real landscape — who holds school records (the MIS vendors), what the department already collects, the separate world of council systems, and why none of their ID numbers match up — plus every source we used."
    asks={[
      'Who actually holds England’s school records — and how concentrated is that market really?',
      'What does the department already collect and keep, and where does the second (local-authority) world sit?',
      'Why don’t the identifiers join — and where does every claim in this study come from?',
    ]}
    askLabel="What this section maps" />

  <!-- The MIS market -->
  <StorySection title="Who holds the records: the MIS market">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Almost every state school runs a “management information system” — its record-keeping software. The market
          is dominated by three companies, and one, Arbor, now holds nearly half of all schools. The simulation draws
          one dot per real school, clustered by vendor, so the biggest clusters are genuinely the biggest vendors.
        {:else}
          The custody question starts here: a child’s record lives inside a commercial MIS. The market is real and
          highly concentrated — the top three carry ~{Math.round((top3 / STATE_CENSUS_TOTAL) * 100)}% of the tracked
          state estate. These are the estates any spine must bring onboard, and the per-vendor counts below (WhichMIS
          October 2025 census) are what the <a href="/projects/data-spine/federation/sim">simulation</a>’s dot field
          reflects, one dot per school.
        {/if}
      </p>
      <div class="stat-row">
        <div class="stat"><b>{gb(STATE_CENSUS_TOTAL)}</b><span>tracked state schools</span></div>
        <div class="stat"><b>{stateVendors.length}</b><span>census vendors</span></div>
        <div class="stat"><b>{Math.round((top3 / STATE_CENSUS_TOTAL) * 100)}%</b><span>held by the top 3</span></div>
      </div>
    {/snippet}
    {#snippet data()}
      <div class="estate">
        {#each stateVendors as s}
          <div class="vend" class:major={s.tier === 'major'}>
            <div class="vend-bar" style="width:{Math.max(3, (s.schools / stateVendors[0].schools) * 100)}%"></div>
            <div class="vend-row">
              <b>{s.label}</b>
              <span class="vend-n">{gb(s.schools)}</span>
            </div>
            <span class="vend-sub">{s.sub}</span>
          </div>
        {/each}
      </div>
      <p class="estate-note"><b>Independent · early-years · bespoke (indicative):</b>
        {tailVendors.map((s) => s.label).join(' · ')} — outside the tracked state census, so their figures are illustrative.</p>
    {/snippet}
  </StorySection>

  <!-- The department's stores -->
  <StorySection title="What the department already keeps">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          The DfE doesn’t start from nothing — it already runs several big data stores built up over decades. Drawn
          honestly here, these are the estate a federated spine would slowly relieve, not pretend never existed.
        {:else}
          The federation argument is not against the department having data — it is against making it grow forever. The
          existing stores below are the current central estate: every collection a query-based spine answers in place
          is one these no longer have to accumulate.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="cards">
        {#each STORES as st}
          <div class="card store">
            <div class="card-head"><b>{st.label}</b><span class="card-sub">{st.sub}</span></div>
            <p>{st.desc}</p>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- The second world: local authorities -->
  <StorySection title="The second world: 153 local authorities">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Schools are only half the picture. Councils run their own separate systems for social care, SEND, admissions
          and children missing education — a whole second world of records, on different software, with different ID
          numbers. Joining a question across both is the hard research problem the simulation dramatises.
        {:else}
          Local authorities are a distinct data estate with their own market — Liquidlogic and OLM Mosaic in social
          care; Capita ONE, Servelec Synergy and Civica in education. A schools × LA question (say, attendance × an
          open social-care plan) is hard precisely because these systems share no analytic key with the school MIS.
          The <a href="/projects/data-spine/federation/sim">simulation</a> models this as a second world, bridged only
          by an identity resolver. The cross-sector worlds (health, cross-government earnings) sit one boundary further out.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="cards">
        {#each LA_HOLDERS as h}
          <div class="card la">
            <div class="card-head"><b>{h.label}</b><span class="card-sub">{h.sub}</span></div>
            <p>{h.desc}</p>
            <span class="card-key">≈{gb(h.cases)} caseload · joins on: {h.key}</span>
          </div>
        {/each}
        {#each CROSS_HOLDERS as h}
          <div class="card cross">
            <div class="card-head"><b>{h.label}</b><span class="card-sub">{h.sub}</span></div>
            <p>{h.desc}</p>
            <span class="card-key">joins on: {h.key}</span>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- The identifiers -->
  <StorySection title="The identifiers that don't join">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Every service uses a different number for the same child, and the school number is legally barred from most
          non-school uses. That mismatch is why joining records is hard — and why “agree one number” is step one.
        {:else}
          The whole difficulty of a spine is compressed into the identifier layer: no shared analytic key exists across
          schools, local authorities and health, and the school UPN is legally restricted. This is the gap the
          consistent-identifier law addresses, and the reason the simulation’s joins return a match confidence rather
          than a clean answer.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="cards">
        {#each idLayers as l}
          <div class="card id">
            <div class="card-head"><b>L{l.no} · {l.name}</b><span class="card-sub">{l.question}</span></div>
            <p><span class="idl">Today</span>{l.today}</p>
            <p><span class="idl">With a spine</span>{l.withSpine}</p>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- The evidence base -->
  <StorySection title="The evidence base — {SOURCES.length} sources">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Every fact in this study has a source. They’re all listed here (and in the footer of every page). Nothing is
          from memory or vibes.
        {:else}
          Every factual claim in the study traces to one of the sources below — government publications, statutory
          bodies, the ICO, academic and civil-society analysis, and the national implementations the recommended model
          borrows from. The same list sits in the footer of every page; it is promoted here because the evidence base
          is itself a source.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <ul class="srcs">
        {#each SOURCES as s}
          <li><a href={s.url} target="_blank" rel="noopener"><b>{s.org}</b> ↗</a> {s.what}</li>
        {/each}
      </ul>
    {/snippet}
  </StorySection>

  <div class="next-row">
    <a class="pe-next" href="/projects/data-spine/architecture">Next: the solutions — four ways to build it →</a>
  </div>
</div>

<style>
  .stat-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
  .stat b { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: 26px; line-height: 1; color: var(--ink); }
  .stat span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); }

  .estate { display: flex; flex-direction: column; gap: 6px; }
  .vend { position: relative; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 8px 12px; overflow: hidden; }
  .vend-bar { position: absolute; inset: 0 auto 0 0; background: var(--accent-ink-tint-12, rgba(14,91,102,0.1)); z-index: 0; }
  .vend.major .vend-bar { background: var(--accent-ink-tint-35, rgba(14,91,102,0.22)); }
  .vend-row, .vend-sub { position: relative; z-index: 1; }
  .vend-row { display: flex; justify-content: space-between; align-items: baseline; }
  .vend-row b { font-family: var(--fs-serif); font-size: var(--fs-body-sm); }
  .vend-n { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink); }
  .vend-sub { display: block; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); margin-top: 1px; }
  .estate-note { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.62); margin: 10px 0 0; }
  .estate-note b { color: rgba(28,22,17,0.8); }

  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .card { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 12px 14px; border-left: 3px solid rgba(28,22,17,0.3); }
  .card.store { border-left-color: #8a5450; }
  .card.la { border-left-color: #356b74; }
  .card.cross { border-left-color: #9a6a2f; }
  .card.id { border-left-color: #7a5aa6; }
  .card-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 5px; }
  .card-head b { font-family: var(--fs-serif); font-size: var(--fs-body-sm); }
  .card-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .card p { font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.74); margin: 4px 0 0; }
  .card-key { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; color: var(--accent-ink); margin-top: 8px; }
  .idl { display: inline-block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.45); margin-right: 6px; }

  .srcs { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 28px; }
  .srcs li { break-inside: avoid; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.72); margin-bottom: 8px; }
  .srcs a { color: var(--accent-ink); text-decoration: none; }
  .srcs a b { color: var(--ink); font-weight: 600; }
  @media (max-width: 760px) { .srcs { columns: 1; } }

  .next-row { margin: 26px 0 16px; }
</style>
