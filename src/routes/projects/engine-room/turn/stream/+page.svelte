<script lang="ts">
  // Getting it back — Part I, leaf 2.
  //
  // The instrument IS the argument: one reconstructed frame sequence, two accumulators, one
  // of which destroys the answer in front of you. Everything else here is a dial reading.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import FrameStream from './components/FrameStream.svelte';
  import { WATCHDOG, STREAM_CONSTANTS } from '../../lib/chat';

  const TONE = 'var(--accent-ink)';

  // WATCHDOG is stored longest-fuse-first. Reversed here so the four tiers read left to right
  // as a ladder of patience. No values are altered — only the display order.
  const TIERS = [...WATCHDOG].reverse();

  /** The constants' own `why` fields, compressed to a readout line. No fact changed. */
  const TIER_WHY: Record<string, string> = {
    'Ordinary turn': 'Nothing is running. Four minutes of silence means something is actually wrong.',
    'Running a tool': 'A long scrape can be legitimately quiet. Sized just under the runtime’s own limit.',
    Delegating: 'A sub-agent grinds through its own loop, emitting nothing on the parent stream.',
    'Waiting on you': 'An approval card is open. Nothing is wrong — a person has not answered yet.',
  };

  const CONST_WHY: Record<string, string> = {
    Heartbeat: 'Proof of life on an otherwise silent stream.',
    'Watchdog tick': 'How often the server checks whether a turn has gone quiet.',
    'Keepalive comment': 'Stops intermediaries closing an idle connection.',
    'Client gap limit': 'How long the browser tolerates silence before reconnecting.',
    'Reconnect attempts': 'Then it stops and says so, rather than hammering forever.',
    'Idle body timeout': 'The transport default of five minutes was silently killing delegated work.',
  };

  const STEPS = TIERS.map((t) => ({ id: t.tier, label: t.tier, sub: `${t.idle} idle · ${t.hard} hard` }));

  let tier = $state(TIERS[0].tier);
  const tierRow = $derived(TIERS.find((t) => t.tier === tier) ?? TIERS[0]);
  // Fall back to the constant's own prose if a compressed line is ever missing.
  const tierWhy = $derived(TIER_WHY[tierRow.tier] ?? tierRow.why);

  // Defaults to the one that came from a real outage.
  let konst = $state('Idle body timeout');
  const konstRow = $derived(STREAM_CONSTANTS.find((c) => c.k === konst) ?? STREAM_CONSTANTS[0]);
  const konstWhy = $derived(CONST_WHY[konstRow.k] ?? konstRow.why);
</script>

<svelte:head>
  <title>Streaming · The Engine Room</title>
  <meta name="description" content="How a streamed answer arrives as a chain of segments, and the accumulator that once overwrote a finished answer." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="turn"
    title="Streaming"
    line="A streamed answer turns up as a chain of segments down one channel. The entire job is stopping them treading on one another."
    lineEli5="The answer arrives as a stream of small pieces, and the job here is putting them together without losing or overwriting any. That is harder than it sounds — this page shows the one mistake that ruins it." />

  <Instrument
    kicker="The failure"
    title="Seven frames, two accumulators"
    tone={TONE}
    reading="A real frame sequence, reconstructed one frame at a time. Run it through either accumulator."
    readingEli5="A real reply, replayed one piece at a time. Assemble it both ways and see which one survives."
    takeaway="Two of the seven frames are not the answer at all. Only one of these two accumulators has the wit to notice."
    takeawayEli5="Two of the seven pieces are progress notes, not answer. The naive assembler pastes them into the reply; the shipped one files them where they belong. That one distinction is the difference between a working chat and a mangled one.">
    <FrameStream />
  </Instrument>

  <Instrument
    kicker="Silence budgets"
    title="How long quiet is allowed"
    tone={TONE}
    reading="Pick a tier."
    readingEli5="Pick what it is waiting on."
    takeaway="How much silence is acceptable depends entirely on what it is waiting for. One global timeout would be simpler and would be wrong four different ways."
    takeawayEli5="Silence means different things depending on what is running: a long tool job can legitimately go quiet for minutes, an ordinary reply cannot. One shared timeout would either kill working jobs or let dead ones linger — so there are four.">
    <div class="wd">
      <Steps items={STEPS} selected={tier} onselect={(id) => (tier = id)} tone={TONE} railed />
    </div>
    <p class="readout" aria-live="polite">{tierWhy}</p>
  </Instrument>

  <Instrument
    kicker="Keeping the pipe open"
    title="Six numbers that hold the stream up"
    tone={TONE}
    reading="Pick one for why."
    readingEli5="Press a number for the reason it is set where it is.">
    <div class="kvs">
      {#each STREAM_CONSTANTS as c (c.k)}
        <button class="kv" class:on={konst === c.k} aria-pressed={konst === c.k} onclick={() => (konst = c.k)}>
          <span class="kv-k">{c.k}</span>
          <span class="kv-v">{c.v}</span>
        </button>
      {/each}
    </div>
    <p class="readout" aria-live="polite"><b>{konstRow.k}</b> — {konstWhy}</p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .readout { margin: 10px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.7);
    min-height: 2.6em; max-width: 82ch; overflow-wrap: anywhere; }
  .readout::before { content: '▸ '; color: var(--accent-ink); }
  .readout b { color: var(--text-primary); font-weight: 600; }

  /* The sub-label carries the actual timeouts — never let it ellipsis away on a phone. */
  @media (max-width: 560px) { .wd :global(.step) { flex: 1 1 100%; } }

  .kvs { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 6px; }
  .kv { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; text-align: left;
    padding: 8px 11px; min-width: 0; cursor: pointer; font-family: inherit;
    border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid rgba(28,22,17,0.16);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; background: rgba(255,255,255,0.55);
    transition: background 0.13s, border-color 0.13s; }
  .kv:hover { background: rgba(255,255,255,0.9); border-color: rgba(28,22,17,0.34); }
  .kv.on { border-left-color: var(--accent-ink); background: color-mix(in srgb, var(--accent-ink) 9%, transparent); }
  .kv-k { font-size: var(--fs-label-xs); line-height: 1.3; color: rgba(28,22,17,0.7); overflow-wrap: anywhere; }
  .kv-v { font-family: var(--font-mono); font-size: var(--fs-body-sm); font-weight: 600;
    letter-spacing: -0.01em; color: var(--text-primary); }
</style>
