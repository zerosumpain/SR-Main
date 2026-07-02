<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import SectorVoices from '../components/SectorVoices.svelte';
  import { SECTOR_THEMES, SECTOR_VOICES, SECTOR_BACKGROUND, VOICE_GROUP_META } from '../lib/sectorVoices';

  const BG_LABEL: Record<string, string> = {
    schoolsweek: 'Schools Week',
    civilserviceworld: 'Civil Service World',
    localAuthorities: 'Local authorities (LGA / ADCS / CCN)',
    mats: 'Trusts & school leaders (CST / ASCL)',
    thirdSector: 'Third sector & civil society',
  };
  const bgKeys = Object.keys(SECTOR_BACKGROUND).filter((k) => (SECTOR_BACKGROUND[k] ?? []).length);
</script>

<svelte:head>
  <title>Voices from the system — Keystone</title>
  <meta name="description" content="What the sector is actually saying about DfE's data agenda — Schools Week, Civil Service World, local authorities, trusts, children's charities and privacy campaigners. The rich tapestry of support, caution and dissent a data strategy has to navigate." />
</svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · Voices from the system"
    title="The data agenda doesn’t happen in a room — it happens across a system"
    thesis="A DfE data strategy lands on a noisy, opinionated system: trusts and councils stretched thin, charities desperate to stop children falling through the cracks, privacy campaigners warning of surveillance, and a centre promising more than it has funded. {SECTOR_VOICES.length} cited voices, grouped by who’s speaking — read them as the weather the strategy has to fly through."
    thesisEli5="Lots of groups have strong, different views on joining up children’s data — schools, councils, charities, privacy campaigners, and government. Here’s what they’re actually saying, and where they clash."
    asks={['Who supports the agenda, who’s wary, and who opposes it', 'The genuine debates beneath the headlines', 'How the sector’s capacity shapes what’s deliverable']}
    askLabel="What this page surfaces"
  />

  <TakeawayBar
    takeaway="Support for joining up children's data is broad — but it is conditional: on funding, on safeguards, and on the sector getting something back for the data it gives."
    takeawayEli5="Most groups want children's data joined up — but only if it's paid for, kept safe, and schools get something useful in return."
    chips={[
      { n: String(SECTOR_VOICES.length), label: 'cited voices', href: '#voices' },
      { n: String(SECTOR_THEMES.length), label: 'live debates', href: '#debates' },
      { n: String(Object.keys(VOICE_GROUP_META).length), label: 'camps' },
    ]}
    drill={[
      { label: 'the debates', href: '#debates' },
      { label: 'who’s saying what', href: '#voices' },
    ]}
  />

  <h2 class="pe-h2" id="debates">The debates beneath the headlines</h2>
  <p class="pe-prose intro">Strip the noise back and the same eight arguments recur. Each is a genuine tension a strategy has to take a position on — not a problem with a tidy answer.</p>
  <div class="themes">
    {#each SECTOR_THEMES as t}
      <div class="theme">
        <h3>{t.title}</h3>
        <p>{t.summary}</p>
      </div>
    {/each}
  </div>

  <h2 class="pe-h2" id="voices">Who’s saying what</h2>
  <p class="pe-prose intro">Grouped by who’s speaking, with the balance of opinion in each camp. Filter by stance to see the spectrum — from the safeguarding case for joining data up, to the privacy case against.</p>
  <SectorVoices />

  {#if bgKeys.length}
    <details class="bg">
      <summary>The detail behind the voices — background by source</summary>
      <div class="bg-body">
        {#each bgKeys as k}
          <div class="bg-grp">
            <h4>{BG_LABEL[k] ?? k}</h4>
            <ul>{#each SECTOR_BACKGROUND[k] as f}<li>{f}</li>{/each}</ul>
          </div>
        {/each}
      </div>
    </details>
  {/if}

  <NextStep
    links={[
      { label: 'Pressure-test a policy against these voices', href: '/projects/dfe-data-strategy/policy-builder', kind: 'primary' },
      { label: 'Write the ethics & trust section', href: '/projects/dfe-data-strategy/author' },
      { label: 'Back to the landscape', href: '/projects/dfe-data-strategy/landscape' },
    ]}
  />
</div>

<style>
  .intro { max-width: 80ch; }
  .themes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 6px 0 8px; }
  .theme { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid #8a2d3a; border-radius: var(--radius-round); background: rgba(255,255,255,0.42); padding: 12px 14px; }
  .theme h3 { margin: 0 0 5px; font-family: 'Fraunces', serif; font-size: 15.5px; font-weight: 600; color: var(--ink); line-height: 1.25; }
  .theme p { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .bg { margin: 26px 0 0; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); background: rgba(255,255,255,0.35); padding: 6px 14px; }
  .bg summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-soft, rgba(28,22,17,0.6)); padding: 8px 0; }
  .bg-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding: 6px 0 12px; }
  .bg-grp h4 { margin: 0 0 5px; font-family: 'Fraunces', serif; font-size: 14px; font-weight: 600; color: var(--ink); }
  .bg-grp ul { margin: 0; padding-left: 16px; }
  .bg-grp li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.7); margin-bottom: 4px; }
  @media (max-width: 820px) { .themes { grid-template-columns: 1fr; } }
</style>
