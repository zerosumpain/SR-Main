<script lang="ts">
  // Three places, one codebase — Part V, leaf 1.
  //
  // The finding worth the page: there is no production branch. The same code is deployed to
  // both machines, and every difference between them is a decision made at startup by reading
  // which machine this is. So the instrument is the matrix of those decisions — it IS the
  // architecture, rather than a picture of it.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import HostMatrix from './components/HostMatrix.svelte';
  import { HOUSE_REASONS, HOUSE_COST, ONE_REGISTER, FLAG_NOT_HOSTNAME, SUBSYSTEMS } from '../../lib/ground';

  const TONE = '#5a6b7a';
  const oneOnly = SUBSYSTEMS.filter((s) => s.runs.length === 1).length;
</script>

<svelte:head>
  <title>Three places, one codebase · The Engine Room</title>
  <meta name="description" content="A public origin with no inbound port, a machine at home doing the three things a data centre cannot, and a disposable machine for unreviewed code — with the same code on all of them." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="ground"
    title="Three places, one codebase"
    line="There is no production branch. The same code runs everywhere, and what a process is permitted to do gets decided at startup by the software working out where it has woken up and adjusting its expectations accordingly."
    lineEli5="The same program runs on a server, on a computer at home, and on a temporary machine that checks new code. Each is allowed to do different things." />

  <Instrument
    kicker="The instrument"
    title="What wakes up where"
    tone={TONE}
    reading="Click a machine to read its column, or a row to read why it is gated that way."
    takeaway="{oneOnly} of the {SUBSYSTEMS.length} run in exactly one place. Two copies of a nightly job writing into one database is not redundancy, it is a race with a database at the end of it — so nearly everything scheduled refuses to start anywhere but the origin, and the scraper refuses everywhere else.">
    <HostMatrix />
  </Instrument>

  <Instrument
    kicker="The awkward one"
    title="Why anything is at home at all"
    tone={TONE}
    reading="Three reasons, and every one of them is a property of the place rather than anything I could fix in software."
    takeaway={HOUSE_COST.body}>
    <ul class="reasons">
      {#each HOUSE_REASONS as r (r.k)}
        <li><b>{r.k}</b><span>{r.why}</span></li>
      {/each}
    </ul>
  </Instrument>

  <aside class="note">
    <span class="n-kick">{ONE_REGISTER.title}</span>
    <p>{ONE_REGISTER.body}</p>
  </aside>

  <aside class="note">
    <span class="n-kick">{FLAG_NOT_HOSTNAME.title}</span>
    <p>{FLAG_NOT_HOSTNAME.body}</p>
  </aside>

  <PageFoot />
</section>

<style>
  .reasons { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 9px; }
  .reasons li { display: flex; flex-direction: column; gap: 3px; padding: 11px 13px;
    border: 1px solid rgba(28,22,17,0.14); border-top: 3px solid #5a6b7a;
    border-radius: var(--radius-round); background: rgba(255,255,255,0.5); }
  .reasons b { font-family: 'Fraunces', serif; font-size: 14.5px; font-weight: 600;
    line-height: 1.25; color: var(--text-primary); }
  .reasons span { font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.7); }

  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid #5a6b7a;
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: rgba(90,107,122,0.09); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: #5a6b7a; }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

</style>
