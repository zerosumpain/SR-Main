<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import EstateStrip from '../components/EstateStrip.svelte';
  import { app } from '../lib/appState.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const eli = $derived(app.narrative === 'eli5');

  const PARTNERS = [
    { name: 'Schools & multi-academy trusts', note: 'Tens of thousands of autonomous bodies, each on their own MIS.' },
    { name: 'Local authorities (~153)', note: 'Children’s services, social care, early help — wildly varied data maturity.' },
    { name: 'Health & social care', note: 'The hardest join: different regimes, identifiers and duties of confidence.' },
    { name: 'Arm’s-length bodies', note: 'Ofqual, Ofsted, the Standards & Testing Agency, the Teaching Regulation Agency.' },
    { name: 'ONS & the centre', note: 'The Integrated Data Service, cross-government linkage and standards.' },
    { name: 'EdTech & MIS suppliers', note: 'Commercial systems that hold much of the sector’s data.' },
  ];

  const FROM_PE = [
    { label: 'The data spine & consistent child identifier', href: '/projects/policy-engine/monitor', note: 'The keystone programme: one safe identifier, a backbone joining education, social care and health.' },
    { label: 'Multi-agency data-sharing (Jigsaw)', href: '/projects/policy-engine/jigsaw', note: 'Why safeguarding fails when agencies see fragments, not the whole child.' },
    { label: 'Attendance data', href: '/projects/policy-engine/attendance', note: 'The daily feed and “similar schools” intelligence behind the absence drive.' },
    { label: 'SEND / EHCP data', href: '/projects/policy-engine/send', note: 'Seeing high-needs demand and outcomes clearly enough to manage the funding cliff.' },
    { label: 'NEET & participation', href: '/projects/policy-engine/neet', note: 'Joining post-16 data to find and support young people not in education or work.' },
  ];
</script>

<svelte:head><title>DfE in context — Keystone</title></svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · DfE in context"
    title="The department, its estate and its partner web"
    thesis="DfE does not own most of the data it depends on. It sits at the centre of a vast, federated system of schools, trusts, councils, agencies and suppliers — each an autonomous data controller. That single fact shapes every strategic choice: you cannot simply mandate; you have to make it worth joining in."
    thesisEli5="DfE doesn’t hold most of the data it needs — schools, councils and others do. So its data strategy is really about getting lots of independent organisations to work together."
    asks={['Who holds the data DfE needs', 'The DfE-specific data programmes already in flight', 'How those connect to the rest of the strategy']}
    askLabel="What this page maps"
  />

  <TakeawayBar
    takeaway="DfE doesn't own most of the data it depends on. Every strategic choice has to make joining in worth it for schools, councils and suppliers — you cannot simply mandate."
    takeawayEli5="Schools and councils hold most of the data, not DfE — so the plan has to make helping out worthwhile for them."
    chips={[
      { n: String(PARTNERS.length), label: 'partner groups', href: '#partner-web' },
      { n: String(FROM_PE.length), label: 'live programmes', href: '#from-pe' },
    ]}
    drill={[{ label: 'the live estate', href: '#estate' }]}
  />

  <h2 class="pe-h2" id="partner-web">The partner web</h2>
  <p class="pe-prose intro">{eli ? 'The organisations DfE has to work with to get a full picture of a child or a school.' : 'Every arrow in a DfE data strategy crosses an organisational boundary. These are the partners whose data must be reached, and on whose cooperation delivery depends.'}</p>
  <div class="web">
    {#each PARTNERS as p}
      <div class="node"><span class="n-name">{p.name}</span><span class="n-note">{p.note}</span></div>
    {/each}
  </div>

  <h2 class="pe-h2" id="from-pe">From the Policy Engine</h2>
  <p class="pe-prose intro">The DfE-specific pressures in this tool are drawn straight from the <a href="/projects/policy-engine">Policy Engine's</a> field studies — the real data demands that the policy modelling surfaced. Each one is an input to the strategy.</p>
  <div class="pe-links">
    {#each FROM_PE as l}
      <a class="pe-link" href={l.href}>
        <span class="pl-label">{l.label} ↪</span>
        <span class="pl-note">{l.note}</span>
      </a>
    {/each}
  </div>

  <h2 class="pe-h2" id="estate">The live estate</h2>
  <p class="pe-prose intro">{eli ? 'The actual data services DfE runs in public — with live numbers pulled from them right now.' : 'The strategy isn’t abstract — it sits on a real, running estate. These are the public-facing DfE data services, with figures pulled live from their APIs this minute (snapshot fallback if an upstream is slow).'}</p>
  <EstateStrip estate={data.estate} />

  <NextStep
    links={[
      { label: 'What the sector says about all this', href: '/projects/dfe-data-strategy/sector', kind: 'primary' },
      { label: 'The commitments creating new flows', href: '/projects/dfe-data-strategy/commitments' },
      { label: 'Draft the strategy', href: '/projects/dfe-data-strategy/author' },
    ]}
  />
</div>

<style>
  .intro { max-width: 80ch; }
  .web { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 0; }
  .node { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 11px 13px; }
  .n-name { display: block; font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
  .n-note { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.65); }
  .pe-links { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pe-link { display: flex; flex-direction: column; gap: 2px; border: 1px solid rgba(138,45,58,0.25); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(138,45,58,0.04); padding: 10px 13px; text-decoration: none; }
  .pe-link:hover { background: rgba(138,45,58,0.1); }
  .pl-label { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #8a2d3a; }
  .pl-note { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  .estate-cta { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin: 26px 0 0; padding: 16px 18px; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); background: rgba(255,255,255,0.4); }
  .estate-cta h3 { margin: 0 0 4px; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: var(--ink); }
  .estate-cta p { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.66); max-width: 64ch; }
  @media (max-width: 820px) { .web { grid-template-columns: 1fr; } .pe-links { grid-template-columns: 1fr; } }
</style>
