<script lang="ts">
  import { app } from './lib/appState.svelte';
  import { PRESSURES } from './lib/pressures';
  import { CAPABILITY_AREAS } from './lib/capabilities';
  import { POSTURE_AXES } from './lib/postures';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const eli = $derived(app.narrative === 'eli5');
  const counts = {
    cross: PRESSURES.filter((p) => p.origin === 'cross-government').length,
    dfe: PRESSURES.filter((p) => p.origin === 'dfe-policy').length,
    partners: PRESSURES.filter((p) => p.origin === 'partners').length,
  };
</script>

<svelte:head>
  <title>Keystone — a DfE data-strategy workbench</title>
  <meta name="description" content="Understand the pressures on DfE's use of data — from across government, from policy, and from partners — and shape a strategy that can deliver against them. A research-grounded decision-support tool." />
</svelte:head>

<div class="pe-route">
  <span class="pe-eyebrow">A data-strategy workbench · companion to the Policy Engine</span>
  <h1 class="pe-h1">What would it actually take for DfE to deliver on data?</h1>
  <p class="pe-lede hero-lede">
    {#if eli}
      Lots of forces pull on how the Department for Education uses data — the rest of government, its own policies, and the schools and councils it works with. This tool lays those pressures out, lets you test different strategies, and shows where they clash.
    {:else}
      Every department is told to treat data as a strategic asset. But a DfE data-strategy lead has to answer to three things at once — the pressures from across government, the data demands of DfE's own policy agenda, and the realities of a vast partner system. Keystone maps those pressures, then lets you test a strategy against them: posture choices and investment trade-offs, scored for coverage, maturity and the tensions they create.
    {/if}
  </p>

  <div class="cta">
    {#if data?.authed}
      <a class="pe-next" href="/projects/dfe-data-strategy/workbench">Open the workbench →</a>
    {/if}
    <a class="pe-next ghost" href="/projects/dfe-data-strategy/landscape">See the pressures landscape →</a>
    <a class="pe-next ghost" href="/projects/dfe-data-strategy/strategies">Which strategies should shape it? →</a>
    <a class="pe-next ghost" href="/projects/dfe-data-strategy/policy-builder">Build &amp; pressure-test a policy →</a>
  </div>

  <div class="origins">
    <a class="org" href="/projects/dfe-data-strategy/landscape" style="--c:#2f6155">
      <span class="o-n">{counts.cross}</span>
      <span class="o-l">pressures from across government</span>
      <span class="o-d">National Data Strategy, the CDDO/DSIT roadmap, AI ambitions, data law.</span>
    </a>
    <a class="org" href="/projects/dfe-data-strategy/landscape" style="--c:#8a2d3a">
      <span class="o-n">{counts.dfe}</span>
      <span class="o-l">pressures from DfE policy</span>
      <span class="o-d">The consistent child identifier, attendance, SEND, NEET — drawn from the Policy Engine.</span>
    </a>
    <a class="org" href="/projects/dfe-data-strategy/landscape" style="--c:#2f6f97">
      <span class="o-n">{counts.partners}</span>
      <span class="o-l">pressures from partners</span>
      <span class="o-d">150+ local authorities, thousands of trusts, the arm's-length bodies, health & care.</span>
    </a>
  </div>

  <h2 class="pe-h2">How the workbench works</h2>
  <div class="how">
    <div class="pe-card">
      <span class="h-step">1 · Take a position</span>
      <p>Set your <b>posture</b> on {POSTURE_AXES.length} core tensions — centralise or federate, build or buy, open or secure, foundations or AI-first — and split a finite pot of effort across {CAPABILITY_AREAS.length} capability areas.</p>
    </div>
    <div class="pe-card">
      <span class="h-step">2 · See the consequences</span>
      <p>A transparent, evidence-weighted engine scores how well your strategy <b>covers the pressures</b>, advances <b>data maturity</b>, and where it creates <b>tensions</b> — incoherent, under-resourced or legally risky combinations.</p>
    </div>
    <div class="pe-card">
      <span class="h-step">3 · Bring your own evidence</span>
      <p>Upload an existing strategy, audit or data map (<b>.docx / .xlsx / .pdf</b>); the model synthesises it, detects maturity signals and the pressures you already address, and suggests where to adjust.</p>
    </div>
  </div>

  <h2 class="pe-h2">Built on the work, not beside it</h2>
  <p class="pe-prose link-para">
    Keystone is a companion to <a href="/projects/policy-engine">the Policy Engine</a> and <a href="/projects/dfe-data-estate">The Data Estate</a>. The DfE-policy pressures are drawn straight from the Policy Engine's field studies — the
    <a href="/projects/policy-engine/monitor">data spine and consistent child identifier</a>, <a href="/projects/policy-engine/attendance">attendance data</a>,
    <a href="/projects/policy-engine/send">SEND</a>, <a href="/projects/policy-engine/neet">NEET</a> and the <a href="/projects/policy-engine/jigsaw">multi-agency data-sharing</a> problem — so the strategy is tested against the real data demands the policy work surfaced.
  </p>
</div>

<style>
  .hero-lede { max-width: 70ch; margin-bottom: 18px; }
  .cta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 26px; }
  .pe-next.ghost { background: transparent; color: var(--ink); border: 1px solid rgba(28,22,17,0.3); }
  .pe-next.ghost:hover { background: rgba(28,22,17,0.06); }
  .origins { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 8px 0 6px; }
  .org { display: flex; flex-direction: column; gap: 3px; border: 1px solid rgba(28,22,17,0.12); border-top: 3px solid var(--c); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; text-decoration: none; }
  .org:hover { background: rgba(255,255,255,0.7); }
  .o-n { font-family: 'Fraunces', serif; font-size: 30px; font-weight: 600; color: var(--c); line-height: 1; }
  .o-l { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--ink); }
  .o-d { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.6); margin-top: 2px; }
  .how { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .how .pe-card p { margin: 6px 0 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); }
  .h-step { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-ink); }
  .link-para { max-width: 80ch; }
  @media (max-width: 820px) { .origins, .how { grid-template-columns: 1fr; } }
</style>
