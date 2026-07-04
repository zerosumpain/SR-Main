<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import RelationshipWeb from '../components/RelationshipWeb.svelte';
  import { RELATIONSHIPS, REL_DYNAMICS } from '../lib/relationships';
  import { app } from '../lib/appState.svelte';
  const eli = $derived(app.narrative === 'eli5');

  const FROM_PE = [
    { label: 'The data spine & consistent child identifier', href: '/projects/policy-engine/monitor', note: 'The keystone programme: one safe identifier, a backbone joining education, social care and health.' },
    { label: 'Multi-agency data-sharing (Jigsaw)', href: '/projects/policy-engine/jigsaw', note: 'Why safeguarding fails when agencies see fragments, not the whole child.' },
    { label: 'Attendance data', href: '/projects/policy-engine/attendance', note: 'The daily feed and “similar schools” intelligence behind the absence drive.' },
    { label: 'SEND / EHCP data', href: '/projects/policy-engine/send', note: 'Seeing high-needs demand and outcomes clearly enough to manage the funding cliff.' },
    { label: 'NEET & participation', href: '/projects/policy-engine/neet', note: 'Joining post-16 data to find and support young people not in education or work.' },
  ];
  const totalFlows = RELATIONSHIPS.reduce((a, r) => a + r.flowsIn.length + r.flowsOut.length, 0);
</script>

<svelte:head><title>The partner web — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · The partner web"
    title="The department and its partner web — how the relationships play out"
    thesis="The department does not own most of the data it depends on. It sits at the centre of a vast, federated system of schools, trusts, councils, agencies and suppliers — each an autonomous data controller. Every relationship is a deal: data flows in under a mandate, something flows back, and the friction in between is where strategies succeed or die. Here is each deal, researched and cited."
    thesisEli5="The department doesn’t hold most of the data it needs — schools, councils and others do. Each relationship is a deal: they send data in, the department gives something back. This page shows every deal, both directions."
    asks={['What the department takes from each partner, and on what legal basis', 'What each partner gets back — and what they actually want', 'The friction in each relationship, and the patterns across them']}
    askLabel="What this page maps"
  />

  <TakeawayBar
    takeaway="The department can compel collection but not goodwill. Every relationship below is a two-way deal — and the strategy's job is to make each one worth joining."
    takeawayEli5="The department can force people to send data, but not to care. Each deal has to be worth it for both sides."
    chips={[
      { n: String(RELATIONSHIPS.length), label: 'relationships', href: '#relationships' },
      { n: String(totalFlows), label: 'documented flows', href: '#relationships' },
      { n: String(REL_DYNAMICS.length), label: 'recurring patterns', href: '#relationships' },
    ]}
    drill={[{ label: 'the live programmes', href: '#from-pe' }]}
  />

  <h2 class="pe-h2" id="relationships">The relationships, deal by deal</h2>
  <p class="pe-prose intro">{eli ? 'Pick a partner to see what they send the department, what the department sends back, the rule that makes it happen, and where it hurts.' : 'Pick a partner. What flows to the department, what flows back, the instrument that mandates it, the friction the relationship actually runs on — verified against primary sources, cited underneath.'}</p>
  <RelationshipWeb />

  <h2 class="pe-h2" id="from-pe">From the Policy Engine</h2>
  <p class="pe-prose intro">The department-specific pressures in this tool are drawn straight from the <a href="/projects/policy-engine">Policy Engine's</a> field studies — the real data demands that the policy modelling surfaced. Each one is an input to the strategy.</p>
  <div class="pe-links">
    {#each FROM_PE as l}
      <a class="pe-link" href={l.href}>
        <span class="pl-label">{l.label} ↪</span>
        <span class="pl-note">{l.note}</span>
      </a>
    {/each}
  </div>

  <NextStep
    links={[
      { label: 'What the sector says about all this', href: '/projects/dfe-data-strategy/sector', kind: 'primary' },
      { label: 'The commitments creating new flows', href: '/projects/dfe-data-strategy/commitments' },
      { label: 'Draft the strategy', href: '/projects/dfe-data-strategy/author' },
    ]}
  />
</div>

<style>
  .intro { max-width: 84ch; }
  .pe-links { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .pe-link { display: flex; flex-direction: column; gap: 2px; border: 1px solid rgba(138,45,58,0.25); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(138,45,58,0.04); padding: 10px 13px; text-decoration: none; }
  .pe-link:hover { background: rgba(138,45,58,0.1); }
  .pl-label { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: #8a2d3a; }
  .pl-note { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.66); }
  @media (max-width: 820px) { .pe-links { grid-template-columns: 1fr; } }
</style>
