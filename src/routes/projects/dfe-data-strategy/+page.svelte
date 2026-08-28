<script lang="ts">
  import { app } from './lib/appState.svelte';
  import { PRESSURES } from '$lib/dfe-data-strategy/pressures';
  import { COMMITMENTS, DOCUMENTS, MUST_ANSWER } from './lib/commitments';
  import { STRATEGIES } from '$lib/dfe-data-strategy/strategies';
  import { SECTOR_VOICES } from '$lib/dfe-data-strategy/sectorVoices';
  import { SECTION_TEMPLATES } from './lib/author/templates';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const eli = $derived(app.narrative === 'eli5');
  const BASE = '/projects/dfe-data-strategy';
  const flowCount = new Set(COMMITMENTS.flatMap((c) => c.flows.map((f) => `${f.from}→${f.to}`))).size;
</script>

<svelte:head>
  <title>Keystone — write an education data strategy</title>
  <meta
    name="description"
    content="A one-stop shop for writing an education data strategy: explore the pressures and white-paper commitments, draft the strategy in a verified editor, and track what changes."
  />
</svelte:head>

<div class="pe-route">
  <span class="pe-eyebrow">A data-strategy workbench · companion to the Policy Engine</span>
  <h1 class="pe-h1">Everything you need to write an education data strategy.</h1>
  <p class="pe-lede hero-lede">
    {#if eli}
      Writing a plan for how the education department uses data is hard: promises from government, pressure from
      schools and councils, and lots of law. Keystone puts it all in one place — learn the landscape, write the plan,
      check it automatically, and watch for changes.
    {:else}
      A data-strategy lead has to hold the whole field in view: {PRESSURES.length} live pressures, the white-paper
      commitments the department is already bound to, the legal stack, and a sector with strong opinions. Keystone is
      the one-stop shop — <b>understand</b> the landscape, <b>write</b> the strategy in a verified editor, and
      <b>track</b> what changes underneath it.
    {/if}
  </p>

  <ol class="path" aria-label="Suggested path">
    <li><a href="{BASE}/commitments"><b>1 · Understand</b><span>what the department is already committed to</span></a></li>
    <li><a href="{BASE}/author"><b>2 · Write</b><span>draft the strategy, section by section</span></a></li>
    <li><a href="{BASE}/author?tab=verify"><b>3 · Verify</b><span>find the gaps before anyone else does</span></a></li>
  </ol>

  <div class="modes">
    <section class="mode" style="--c:#2f6155">
      <span class="m-kicker">Understand</span>
      <p class="m-promise">The landscape the strategy must answer — mapped, sourced, explorable.</p>
      <div class="m-stats">
        <a href="{BASE}/commitments"><b>{COMMITMENTS.length}</b> commitments from {DOCUMENTS.length} documents</a>
        <a href="{BASE}/landscape"><b>{PRESSURES.length}</b> pressures from three directions</a>
        <a href="{BASE}/sector"><b>{SECTOR_VOICES.length}</b> sector voices</a>
      </div>
      <nav class="m-links">
        <a href="{BASE}/commitments">Commitments</a>
        <a href="{BASE}/landscape">Landscape</a>
        <a href="{BASE}/strategies">Influence map</a>
        <a href="{BASE}/frameworks">Frameworks</a>
        <a href="{BASE}/legislation">Legislation</a>
        <a href="{BASE}/dfe">Partner web</a>
        <a href="{BASE}/sector">Sector voices</a>
      </nav>
    </section>

    <section class="mode write" style="--c:#8a2d3a">
      <span class="m-kicker">Write</span>
      <p class="m-promise">Draft the strategy in the product — and let the machine check it.</p>
      <div class="m-stats">
        <a href="{BASE}/author"><b>{SECTION_TEMPLATES.length}</b> guided sections, WYSIWYG</a>
        <a href="{BASE}/author?tab=verify"><b>{MUST_ANSWER.length || COMMITMENTS.length}</b> obligations swept for coverage</a>
        {#if data?.authed}
          <a href="{BASE}/author?tab=diagnose"><b>◆</b> diagnose → draft → verify → plan, one workspace</a>
        {/if}
      </div>
      <nav class="m-links">
        <a href="{BASE}/author" class="hot">✎ Open the workspace</a>
        <a href="{BASE}/policy-builder">Policy builder</a>
      </nav>
    </section>

    <section class="mode" style="--c:#2f6f97">
      <span class="m-kicker">Track</span>
      <p class="m-promise">The landscape moves. New intelligence lands inside the section it changes.</p>
      <div class="m-stats">
        <a href="{BASE}/legislation"><b>◉</b> daily GOV.UK sweep — new law on the legal page, programmes on the ledger</a>
        <a href="{BASE}/strategies"><b>{STRATEGIES.length}</b> strategies on the influence map</a>
      </div>
      <nav class="m-links">
        <a href="{BASE}/legislation">Legislation</a>
        <a href="{BASE}/commitments">Commitments</a>
        <a href="{BASE}/method">How it works</a>
      </nav>
    </section>
  </div>

  <h2 class="pe-h2">Built on the work, not beside it</h2>
  <p class="pe-prose link-para">
    Keystone is a companion to <a href="/projects/policy-engine">the Policy Engine</a> and
    <a href="/projects/dfe-data-estate">The Data Estate</a>. The department-policy pressures are drawn straight from the
    Policy Engine's field studies — the
    <a href="/projects/policy-engine/monitor">data spine and consistent child identifier</a>,
    <a href="/projects/policy-engine/attendance">attendance data</a>, <a href="/projects/policy-engine/send">SEND</a>,
    <a href="/projects/policy-engine/neet">NEET</a> and the
    <a href="/projects/policy-engine/jigsaw">multi-agency data-sharing</a> problem — and the commitments ledger is
    synthesized from the 2024–26 white-paper landscape, verified against primary sources.
  </p>
</div>

<style>
  .hero-lede {
    max-width: 74ch;
    margin-bottom: 20px;
  }
  .hero-lede b {
    color: var(--ink);
  }

  .path {
    list-style: none;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 0 0 22px;
    padding: 0;
    counter-reset: step;
  }
  .path li {
    flex: 1 1 200px;
  }
  .path a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 11px 15px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    text-decoration: none;
  }
  .path a:hover {
    background: rgba(28, 22, 17, 0.05);
    border-color: rgba(28, 22, 17, 0.4);
  }
  .path b {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .path span {
    font-size: var(--fs-label);
    line-height: 1.4;
    color: rgba(28, 22, 17, 0.68);
  }

  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 13px;
    margin: 4px 0 8px;
  }
  .mode {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-top: 4px solid var(--c);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.45);
    padding: 15px 17px 14px;
  }
  .m-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--c);
    font-weight: 600;
  }
  .m-promise {
    margin: 0;
    font-family: var(--fs-serif);
    font-size: 16.5px;
    font-weight: 500;
    line-height: 1.35;
    color: var(--ink);
    min-height: 44px;
  }
  .m-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .m-stats a {
    font-size: var(--fs-label);
    color: rgba(28, 22, 17, 0.7);
    text-decoration: none;
  }
  .m-stats a:hover {
    color: var(--ink);
  }
  .m-stats b {
    font-family: var(--fs-serif);
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--c);
    margin-right: 3px;
  }
  .m-links {
    display: flex;
    gap: 5px 7px;
    flex-wrap: wrap;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px dashed rgba(28, 22, 17, 0.15);
  }
  .m-links a {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    color: var(--ink);
    text-decoration: none;
    padding: 4px 10px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.5);
  }
  .m-links a:hover {
    background: rgba(28, 22, 17, 0.06);
    border-color: rgba(28, 22, 17, 0.4);
  }
  .m-links a.hot {
    background: var(--c);
    color: #fff;
    border-color: var(--c);
  }
  .m-links a.hot:hover {
    filter: brightness(0.9);
  }

  .link-para {
    max-width: 80ch;
  }
  @media (max-width: 900px) {
    .modes {
      grid-template-columns: 1fr;
    }
    .m-promise {
      min-height: 0;
    }
  }
</style>
