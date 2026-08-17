<script lang="ts">
  // The cost of being able — Part III, leaf 1.
  //
  // One argument: a capability is billed as prompt before it does anything. The switch makes
  // it, the two-bar chart shows what it costs against a real prompt, and the tiers are a
  // chart rather than three cards of prose. The constants' long `what`/`why` fields are
  // compressed to labels and one readout line each — no figure is changed.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import StackBar from '../../components/viz/StackBar.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import ManifestBudget from './components/ManifestBudget.svelte';
  import { MANIFEST, TIERS, LESSONS } from '../../lib/tools';

  const TONE = 'var(--success)';
  const GREY = 'rgba(28,22,17,0.42)';

  // Derived from the measured constants, not new measurements: the median prompt already
  // contains the served manifest, so the remainder is everything that is not a tool
  // description. The second bar swaps the served manifest for the full catalogue.
  const REST = MANIFEST.medianPrompt - MANIFEST.servedTokens;
  const FULL_PROMPT = REST + MANIFEST.fullTokens;
  const ELSE = 'Everything else in the prompt';

  const ROWS = [
    {
      id: 'served',
      label: 'As served · 21 definitions',
      total: MANIFEST.medianPrompt,
      segments: [
        { label: '21 tool definitions', value: MANIFEST.servedTokens, tone: TONE },
        { label: ELSE, value: REST, tone: GREY },
      ],
    },
    {
      id: 'full',
      label: 'If all 155 were sent',
      total: FULL_PROMPT,
      segments: [
        { label: '155 tool definitions', value: MANIFEST.fullTokens, tone: 'var(--error)' },
        { label: ELSE, value: REST, tone: GREY },
      ],
    },
  ];

  const SEG_WHY: Record<string, string> = {
    '21 tool definitions': 'Twenty essentials plus one dispatcher — the only abilities described up front.',
    '155 tool definitions': 'Every ability described before the model has read a single word of the question.',
    [ELSE]: 'Standing instructions, retrieved context and the conversation so far.',
  };

  let seg = $state<string | null>(null);
  const segLine = $derived((seg ? SEG_WHY[seg] : null) ?? 'Pick a block.');

  // The share the tool list takes of the prompt it produces — 18% as served, 46% in full.
  const fullSharePct = Math.round((MANIFEST.fullTokens / FULL_PROMPT) * 100);
  const servedSharePct = Math.round((MANIFEST.servedTokens / MANIFEST.medianPrompt) * 100);

  // TIERS by count. The inversion is the point: the longest bar is the free one. Each tier
  // name is 'Head — qualifier'; the head is the bar label, the qualifier joins the cost.
  const TIER_BARS = TIERS.map((t, i) => {
    const [head, tail] = t.tier.split(' — ');
    return {
      label: head,
      value: t.count,
      note: tail ? `${tail} · ${t.cost}` : t.cost,
      tone: [TONE, 'var(--accent)', 'rgba(28,22,17,0.45)'][i],
    };
  });

  // The five lessons, compressed to a tag and one line each. Same claims, fewer words.
  const LESSON_UI: Record<string, { tag: string; line: string }> = {
    'The model prices your instructions': {
      tag: 'Visibility beats wording',
      line: 'A tool the prompt calls mandatory still loses to one that is merely visible. Check the tier before rewriting the sentence.',
    },
    'Documentation is what blows the budget, not schema': {
      tag: 'Prose, not schema',
      line: 'One essential tool cost 3,147 tokens — about eleven of its twelve and a half kilobytes were prose, against a one-kilobyte schema.',
    },
    'A filter that matches nothing returns everything, loudly': {
      tag: 'Empty filter, full catalogue',
      line: 'A zero-match filter returns everything. Silence reads to a model as proof of absence.',
    },
    'Every cross-cutting concern has to unwrap the same envelope': {
      tag: 'Gates must unwrap',
      line: 'One dispatcher masks 135 names, so gating, logging and auditing each have to resolve the inner tool first.',
    },
    'Instrument the thing that actually ran': {
      tag: 'Audit what ran',
      line: 'The obvious audit table is dead — the live engine never writes to it. Reading it would have shown a dashboard of zeros.',
    },
  };

  let lesson = $state(LESSONS[0].title);
  const lessonLine = $derived(LESSON_UI[lesson]?.line ?? '');
</script>

<svelte:head>
  <title>Tools · The Engine Room</title>
  <meta name="description" content="Every tool a model can call is described to it on every turn. What that costs, and the dispatcher that stops it." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="reach"
    title="Tools"
    line="Every tool a model may call is described to it in full, on every single turn, before you have typed a word. Capability is billed as prompt whether you use it or not."
    lineEli5="The AI is told about every button it could press, on every message you send — and it is charged for the telling. This page is about keeping that list short without losing any of the buttons." />

  <Instrument
    kicker="The switch"
    title="Send all 155, or send 21"
    tone={TONE}
    reading="The fill is to scale against the full catalogue. Flip it."
    readingEli5="The fill is drawn to scale against the full catalogue. Flip the switch."
    takeaway="Identical capabilities either way. One of them charges you for all 155 on every message you send, up to and including “hi”."
    takeawayEli5="Both settings can do exactly the same things. One of them bills you for all 155 descriptions on every message you send, up to and including “hi”.">
    <ManifestBudget />
  </Instrument>

  <Instrument
    kicker="The budget"
    title="Where a median prompt goes"
    tone={TONE}
    reading="Both bars share one scale. Percentages are of that prompt."
    readingEli5="Both bars share one scale. Press a block to see what it is."
    takeaway="Sent in full, the tool list goes from {servedSharePct}% of the prompt to {fullSharePct}%."
    takeawayEli5="Sent in full, the tool list swells from {servedSharePct}% of a message's cost to {fullSharePct}%. Trimming it pays for itself on every single message.">
    <div class="rows">
      {#each ROWS as r (r.id)}
        <div class="row" style="--w:{(r.total / FULL_PROMPT) * 100}%">
          <div class="r-head">
            <span class="r-lab">{r.label}</span>
            <span class="r-tot">{r.total.toLocaleString('en-GB')} tokens</span>
          </div>
          <StackBar segments={r.segments} unit=" tokens" height={38}
                    selected={seg} onselect={(l) => (seg = seg === l ? null : l)} />
        </div>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{segLine}</p>
    <p class="gap">The gap is <b>{MANIFEST.savedTokens.toLocaleString('en-GB')} tokens</b>: the {MANIFEST.hidden} tools not sent.</p>
  </Instrument>

  <Instrument
    kicker="Three tiers"
    title="What each tier costs"
    tone={TONE}
    reading="Length is the count. The note is the cost per turn."
    readingEli5="Bar length is how many tools; the note is what they cost on every message."
    takeaway="The longest bar is the free one, which is not how any of this normally works. Nothing has been deleted — it is all still there, just not shouted about up front."
    takeawayEli5="The longest bar is the free one: most tools cost nothing until asked for. Nothing has been deleted — it is all still there, just not announced up front on every message.">
    <Bars items={TIER_BARS} tone={TONE} grouped={false} height={24} />
    <p class="gap"><b>{MANIFEST.invokeShare}% of dispatcher calls</b> go straight to invoke; browsing is rare.</p>
  </Instrument>

  <Instrument
    kicker="Lessons"
    title="Five things that only ever show up in production"
    tone={TONE}
    reading="Pick one."
    readingEli5="Pick a lesson.">
    <div class="tags">
      {#each LESSONS as l (l.title)}
        <button class="tag" class:on={lesson === l.title} aria-pressed={lesson === l.title}
                onclick={() => (lesson = l.title)}>{LESSON_UI[l.title]?.tag ?? l.title}</button>
      {/each}
    </div>
    <p class="readout" aria-live="polite">{lessonLine}</p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .rows { display: flex; flex-direction: column; gap: 14px; }
  /* Only the track is scaled to the shared axis — the key stays full width and readable. */
  .row :global(.track) { width: var(--w); }

  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    flex-wrap: wrap; margin-bottom: 5px; }
  .r-lab { font-size: var(--fs-label); font-weight: 500; color: var(--text-primary); }
  .r-tot { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }

  .readout { margin: 11px 0 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.72);
    min-height: 2.6em; max-width: 82ch; }
  .readout::before { content: '▸ '; color: var(--success); }

  .gap { margin: 9px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.6); max-width: 84ch; }
  .gap b { color: var(--text-primary); }

  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { padding: 6px 12px; cursor: pointer; font-family: inherit; font-size: var(--fs-label-xs); line-height: 1.25;
    color: rgba(28,22,17,0.78); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-pill); background: rgba(255,255,255,0.6);
    transition: background 0.13s, border-color 0.13s, color 0.13s; }
  .tag:hover { background: rgba(255,255,255,0.95); border-color: rgba(28,22,17,0.36); }
  .tag.on { border-color: var(--success); color: var(--text-primary); font-weight: 500;
    background: color-mix(in srgb, var(--success) 12%, transparent); }
</style>
