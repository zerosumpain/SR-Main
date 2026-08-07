<script lang="ts">
  // One doorway — Part III, leaf 2.
  //
  // The argument is structural, so the instrument is structural: four callers, one boundary.
  // Switching caller is deliberately inert — that is the finding. The facts constant becomes
  // a key/value strip with one readout line, not four paragraphs in four cards.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import CallGate from './components/CallGate.svelte';
  import { MCP_FACTS } from '../../lib/tools';

  // Provenance for every hand-written string on this page, so nothing can drift into
  // invention. Captions are compressions of these constants and add no figure or claim:
  //   · instrument 1 takeaway  → lib/guardrails.ts RAILS('destructive').note
  //   · instrument 3 reading   → lib/tools.ts GATEWAY.problem + .fix + .evidence
  //   · instrument 3 takeaway  → lib/tools.ts GATEWAY.lesson
  //   · readout lines below    → lib/tools.ts MCP_FACTS[].why
  const TONE = 'var(--success)';

  /** MCP_FACTS' own `why` fields, compressed to a single readout line. No fact changed. */
  const WHY: Record<string, string> = {
    'What it is': 'Any compliant client drives the same tools the assistant uses — not a reduced copy.',
    'The wire format': 'Requests in, results out, over a transport that survives the server restarting underneath it.',
    'One registry': 'One tool serves the assistant, a workflow, the builder and an external client. Nothing is wired twice.',
    'Destructive operations': 'The check sits where every route to a tool must pass, so a new caller cannot arrive without it.',
  };

  // Defaults to the fact the page exists to make.
  let fact = $state('One registry');
  const row = $derived(MCP_FACTS.find((f) => f.k === fact) ?? MCP_FACTS[0]);

  /** GATEWAY.evidence, as counted: the same 40 calls placed twice across three restarts. */
  const AVAIL = [
    { label: 'Placed directly', value: 17, note: '23 failed mid-restart', tone: 'var(--error)' },
    { label: 'Through the gateway', value: 40, note: 'none failed', tone: 'var(--success)' },
  ];
</script>

<svelte:head>
  <title>One doorway · The Engine Room</title>
  <meta name="description" content="How outside tools connect over one open protocol, and where the check on a destructive call actually sits." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="One doorway"
    line="One open protocol carries every tool to every caller, so the check on a dangerous call has to sit in the doorway rather than in the caller."
    lineEli5="Outside apps plug into the same tools the assistant uses. The safety check lives in the plug, not in each app." />

  <Instrument
    kicker="The gate"
    title="Four ways in, one check"
    tone={TONE}
    reading="Pick who is calling, what kind of call it is, and whether anyone is there to answer."
    takeaway="Changing the caller never moves the verdict, because the gate sits at the boundary every route must pass rather than inside any one of them — which is the only placement that a new caller cannot arrive without.">
    <CallGate />
  </Instrument>

  <Instrument
    kicker="The endpoint"
    title="The protocol in four lines"
    tone={TONE}
    reading="Pick a line for why it is that way.">
    <div class="kvs">
      {#each MCP_FACTS as f (f.k)}
        <button class="kv" class:on={fact === f.k} aria-pressed={fact === f.k} onclick={() => (fact = f.k)}>
          <span class="kv-k">{f.k}</span>
          <span class="kv-v">{f.v}</span>
        </button>
      {/each}
    </div>
    <p class="readout" aria-live="polite"><span class="r-mark" aria-hidden="true">▸</span>{WHY[row.k] ?? row.why}</p>
  </Instrument>

  <Instrument
    kicker="Staying open"
    title="What a deploy does to a call in flight"
    tone={TONE}
    reading="Forty calls across three deliberate restarts, placed twice: straight at the endpoint, then through a process that holds a call for up to three minutes rather than failing it."
    takeaway="A component whose whole job is surviving the main application’s restarts must not share its fate — so it is dependency-free and supervised separately.">
    <Bars items={AVAIL} unit=" of 40" max={40} tone={TONE} grouped={false} height={30} />
  </Instrument>

  <PageFoot />
</section>

<style>
  .kvs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 6px; }
  .kv { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left;
    padding: 8px 11px; min-width: 0; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; background: rgba(255,255,255,0.55);
    transition: background 0.13s, border-color 0.13s; }
  .kv:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.34); }
  .kv.on { border-left-color: var(--success); background: color-mix(in srgb, var(--success) 9%, transparent); }
  .kv-k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .kv-v { font-size: 13.5px; font-weight: 600; line-height: 1.3; color: var(--text-primary);
    overflow-wrap: anywhere; }

  /* The mark is markup rather than generated content so it can be hidden from assistive
     tech — the house pattern in Instrument.svelte's caption. */
  .readout { display: flex; gap: 7px; margin: 10px 0 0; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.7); min-height: 2.6em; max-width: 82ch; }
  .r-mark { color: var(--success); flex-shrink: 0; }
</style>
