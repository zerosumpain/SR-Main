<script lang="ts">
  // Where it all comes from — Part II, leaf 1.
  //
  // One finding carries this page: the channels are not peers, and the axis that separates
  // them is not the one anyone expects. It is not volume and it is not cost — it is who wrote
  // the words. Two channels carrying the same author are graded identically even though one
  // is a note on a phone and the other a message thread, and the mail channel is where the
  // consequence is visible: its free half is also its more trustworthy half.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import ChannelBoard from './components/ChannelBoard.svelte';
  import MailSweep from './components/MailSweep.svelte';
  import DecayCurve from './components/DecayCurve.svelte';
  import { QUOTE_TRAP, DECAY_NOTE, CADENCE } from '../../lib/channels';

  const TONE = 'var(--accent)';
</script>

<svelte:head>
  <title>Where it all comes from · The Engine Room</title>
  <meta name="description" content="Eight channels feed one knowledge graph — notes, messages, documents, mail, research, the web, automation and conversation — and they are graded by who authored them, not by how they arrived." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Where it all comes from"
    line="Eight doors feed one graph. What separates them is not volume or cost but authorship — and grading by authorship is what stops the same sentence scoring two different ways."
    lineEli5="Information reaches it eight different ways. How much it trusts each one depends on who wrote it, not on how it got there." />

  <Instrument
    kicker="The instrument"
    title="Eight doors, three differences"
    tone={TONE}
    reading="Chips are grouped by the grade their source carries. Pick one."
    takeaway="Two channels sit at the top for the same reason — you wrote them — even though one is a note on a phone and the other a message thread. A grade records authorship; the transport is not evidence of anything.">
    <ChannelBoard />
  </Instrument>

  <Instrument
    kicker="The largest channel"
    title="One sweep, two halves, one budget"
    tone={TONE}
    reading="A worked mailbox of 900 threads in the window. Set what a night may spend."
    takeaway="Drag the budget to zero and the graph still learns who corresponds with whom. The free half is read off the headers, which makes it both the cheaper evidence and the better evidence — so it is never the half that gets cut.">
    <MailSweep />
  </Instrument>

  <aside class="note warn">
    <span class="n-kick">{QUOTE_TRAP.title}</span>
    <p>{QUOTE_TRAP.body}</p>
  </aside>

  <Instrument
    kicker="What twelve weeks of mail does"
    title="Evidence fades, and only halfway"
    tone={TONE}
    reading="A fully corroborated edge, plotted against how long ago it was last observed."
    takeaway={DECAY_NOTE.body}>
    <DecayCurve />
  </Instrument>

  <aside class="note">
    <span class="n-kick">A cadence, not a rule</span>
    <p>
      The old cadence for re-reading a conversation — turn two, then every fourth — was a near-total loss:
      the median thread runs {CADENCE.medianTurns} turns, shorter than the gap. It now reads every one of
      the first {CADENCE.denseUntil} and thins out after.
    </p>
  </aside>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .note.warn { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .note.warn .n-kick { color: #8a2d3a; }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

</style>
