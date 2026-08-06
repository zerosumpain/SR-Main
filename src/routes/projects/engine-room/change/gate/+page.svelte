<script lang="ts">
  // The gate — Part IV, leaf 2.
  //
  // The console is the argument: pick a handler the night shift might have written and try to
  // get it past the scan. The second instrument is the map of what that scan is defending —
  // fourteen patterns are a list, six things they would reach is a shape.
  //
  // Nothing here restates what the console already shows. The old version spent a paragraph
  // explaining that the scan runs before compilation; now the step label says so, in place.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import StackBar from '../../components/viz/StackBar.svelte';
  import VerifyGate from './components/VerifyGate.svelte';
  import { CANDIDATES, FORBIDDEN } from '../../lib/building';

  const TONE = '#8a2d3a';

  // The deny-list, grouped by what a handler would reach if the pattern got through.
  // Group tones are palette tokens, not literals; the part tone stays the one hex the
  // study assigns to Part IV.
  // Membership is by the constants' own pattern strings, so the chart reads the same list the
  // scan does; anything the groups fail to claim is swept into the last one rather than
  // silently vanishing from the total.
  const GROUPS = [
    { label: 'Turn a string into code', tone: '#8a2d3a', pats: ['eval(', 'Function(', '.constructor('] },
    { label: 'Reach the environment', tone: 'var(--accent-ink)', pats: ['process', 'globalThis', '__dirname / __filename'] },
    { label: 'Load a module', tone: 'var(--accent)', pats: ['require(', 'import('] },
    { label: 'Touch the filesystem', tone: 'var(--warn)', pats: ['fs.', 'readFile / writeFile'] },
    { label: 'Start something new', tone: 'var(--success)', pats: ['child_process', 'new Worker'] },
    { label: 'Outlive or obscure the call', tone: '#5a6b7a', pats: ['setInterval', 'Buffer.from(…base64)'] },
  ];

  const claimed = new Set(GROUPS.flatMap((g) => g.pats));
  const orphans = FORBIDDEN.filter((f) => !claimed.has(f.pat));

  const rows = GROUPS.map((g, i) => ({
    label: g.label,
    tone: g.tone,
    items: [...FORBIDDEN.filter((f) => g.pats.includes(f.pat)), ...(i === GROUPS.length - 1 ? orphans : [])],
  }));

  const segments = rows.map((g) => ({ label: g.label, value: g.items.length, tone: g.tone }));

  let group = $state(GROUPS[0].label);
  const shown = $derived(rows.find((g) => g.label === group) ?? rows[0]);
</script>

<svelte:head>
  <title>The gate · The Engine Room</title>
  <meta
    name="description"
    content="{FORBIDDEN.length} deny-list patterns and a smoke test stand between code an AI wrote overnight and a live runtime." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="The gate"
    line="Tools the night shift writes are registered live, with nobody in the loop. A scan of {FORBIDDEN.length} patterns and a smoke test are what make that safe."
    lineEli5="The system writes new abilities for itself while nobody is watching. These are the checks that stop a bad one going live." />

  <Instrument
    kicker="The instrument"
    title="Run the gate on {CANDIDATES.length} handlers"
    tone={TONE}
    reading="Pick a handler the engine might have authored. Two checks, in order — the scan reads raw source before compilation."
    takeaway="Both are absolute: a clean scan, and every smoke case passing — not most. Source that trips the scan is rejected before it is ever compiled.">
    <VerifyGate />
  </Instrument>

  <Instrument
    kicker="The deny-list"
    title="What the {FORBIDDEN.length} patterns are defending"
    tone={TONE}
    reading="Each pattern grouped by what a handler would reach if it got through. Pick a group."
    takeaway="Blunt on purpose. A bare process catches environment access, exit and argv in one, at the cost of occasionally refusing something harmless.">
    <StackBar {segments} unit=" patterns" selected={group} onselect={(l) => (group = l)} />

    <ul class="pats" aria-live="polite">
      {#each shown.items as f (f.pat)}
        <li><code>{f.pat}</code><span>{f.why}</span></li>
      {/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  /* A floor of two rows: groups hold two or three patterns, so switching between them
     changes the list without the page jumping under the pointer. */
  .pats { list-style: none; margin: 12px 0 0; padding: 10px 0 0; min-height: 42px;
    border-top: 1px dashed rgba(28,22,17,0.18);
    display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 16px; }
  .pats li { display: flex; align-items: baseline; gap: 8px; min-width: 0;
    font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); }
  .pats code { flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
    color: var(--text-primary); background: color-mix(in srgb, #8a2d3a 12%, transparent);
    padding: 2px 6px; border-radius: var(--radius-sharp); }
  .pats span { min-width: 0; overflow-wrap: anywhere; }

  @media (max-width: 560px) {
    .pats { grid-template-columns: 1fr; }
  }
</style>
