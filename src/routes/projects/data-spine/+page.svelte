<script lang="ts">
  // BRIEFING — what the data spine is: the commitment verbatim, the five-layer
  // anatomy, spine vs identifier, and the timeline that explains the trust stakes.
  import { app } from './lib/appState.svelte';
  import { QUOTES, STATUS, LAYERS, SPINE_VS_ID, TIMELINE, TAG_META } from './lib/spine';
  import StoryMasthead from './components/StoryMasthead.svelte';
  import StorySection from './components/StorySection.svelte';
  import ConfidenceBadge from './components/ConfidenceBadge.svelte';

  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>The Data Spine — what is the DfE actually proposing?</title>
  <meta name="description" content="A research interactive on the Department for Education's proposed education data spine: what it is, the precedents, the stakeholders, and the governance design." />
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Briefing"
    title="What is the education data spine?"
    thesis="In February 2026 the government committed, in one paragraph of a white paper, to build a “data spine” for English education. This project takes that paragraph seriously: what a spine actually is, what it would be worth, who wants what from it — and how it could be built without repeating the mistakes already made with children's data."
    thesisEli5="The government promised new national plumbing for school data — in a single paragraph, with no design. This project unpacks what that could mean, who wins and loses, and how to build it safely."
    asks={[
      'What exactly has been announced — and what remains undecided?',
      'What is a “data spine” made of? (Five layers, each with different options and risks)',
      'How does the spine differ from the consistent child identifier — and why does confusing them matter?',
    ]}
    askLabel="What this briefing answers" />

  <!-- The commitment, verbatim -->
  <StorySection title="The commitment, verbatim">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          Three quotes are the entire public record of the data spine. Everything else — who builds it, where records live,
          who can look — is still to be decided, starting with a consultation in summer 2026.
        {:else}
          The full public specification of the data spine fits in three quotations. The white paper names the data in scope
          (pupil records, attendance, progress, assessment) and the qualities demanded (secure, privacy-respecting, streamlined)
          — and nothing else: no architecture, no custodian, no budget, no delivery date. Proposals go to consultation in summer 2026;
          the white paper's own phasing puts full implementation at 2028–29.
        {/if}
      </p>
      <div class="status-card">
        <span class="st-label">Status</span>
        <b>{STATUS.headline}</b>
        <p>{eli ? STATUS.eli5 : STATUS.detail}</p>
        <ConfidenceBadge level={STATUS.confidence} />
      </div>
    {/snippet}
    {#snippet data()}
      <div class="quotes">
        {#each QUOTES as q}
          <blockquote class="quote">
            <p>“{q.text}”</p>
            <footer>
              <b>{q.who}</b> · {q.where} · {q.date}
              <a href={q.url} target="_blank" rel="noopener">source ↗</a>
            </footer>
          </blockquote>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Five-layer anatomy -->
  <StorySection title="Anatomy: five layers, five arguments">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          “Spine” sounds like one thing. It's really five stacked jobs — a number, a phone book, pipes, a shared language,
          and a rulebook. Each can be built several ways, and the fights are different at each layer.
        {:else}
          A spine is not a single system but a stack of five functions, borrowed here from the systems that inspired the name
          (the NHS Spine above all). Decomposing it matters because every layer has its own design options, its own precedents,
          and its own failure modes — and because the public argument routinely collapses them into one scary word, <b>database</b>,
          which is precisely the design the precedents warn against.
        {/if}
      </p>
      <p class="pe-prose">The governance layer is deliberately last: it is the least designed, and the one this project's
        <a href="/projects/data-spine/governance">largest section</a> is devoted to.</p>
    {/snippet}
    {#snippet data()}
      <div class="layers">
        {#each LAYERS as l}
          <div class="layer">
            <div class="layer-head">
              <span class="layer-no">L{l.no}</span>
              <b>{l.name}</b>
              <span class="layer-q">{l.question}</span>
            </div>
            {#if eli}
              <p class="layer-eli">{l.eli5}</p>
            {:else}
              <div class="layer-cols">
                <div><span class="ds-kicker">Today</span><p>{l.today}</p></div>
                <div><span class="ds-kicker">With a spine</span><p>{l.withSpine}</p></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Spine vs identifier -->
  <StorySection title="The spine is not the identifier">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          {SPINE_VS_ID.eli5}
        {:else}
          {SPINE_VS_ID.intro} The identifier is in statute with pilots running; the spine is a white-paper ambition.
          They will be judged together in public, but they can succeed or fail separately — and the privacy analysis of each is different.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="vs">
        {#each [SPINE_VS_ID.spine, SPINE_VS_ID.identifier] as side, i}
          <div class="vs-card" class:id-card={i === 1}>
            <h3>{side.name}</h3>
            <p class="ds-body">{side.what}</p>
            <p class="ds-body"><b>Basis:</b> {side.basis}</p>
            <p class="ds-body"><b>Status:</b> {side.status}</p>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Timeline -->
  <StorySection title="How England got here, 2002–2026">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          The history matters because it repeats: build something big and central, lose trust, retreat, try again smaller.
          The red entries are why parents' groups don't take “privacy-respecting” on faith.
        {:else}
          Two threads run through the timeline. The <b>infrastructure</b> thread builds capability: NPD, the attendance feed,
          the Education Record, now the spine. The <b>trust</b> thread spends it: ContactPoint, the 2012 distribution era,
          the Home Office MoU, the ICO audit. The spine consultation inherits the balance of both accounts —
          which is why architecture alone cannot answer the objections.
        {/if}
      </p>
      <div class="tl-legend">
        {#each Object.entries(TAG_META) as [k, m]}
          <span class="tl-key"><i style="background:{m.color}"></i>{m.label}</span>
        {/each}
      </div>
    {/snippet}
    {#snippet data()}
      <ol class="timeline">
        {#each TIMELINE as t}
          <li class="tl-item">
            <span class="tl-dot" style="background:{TAG_META[t.tag].color}"></span>
            <div class="tl-body">
              <div class="tl-head">
                <span class="tl-date">{t.date}</span>
                <b>{t.title}</b>
                <span class="tl-tag" style="color:{TAG_META[t.tag].color}; border-color:{TAG_META[t.tag].color}">{TAG_META[t.tag].label}</span>
              </div>
              <p>{t.detail}{#if t.url}&nbsp;<a href={t.url} target="_blank" rel="noopener">↗</a>{/if}</p>
            </div>
          </li>
        {/each}
      </ol>
    {/snippet}
  </StorySection>

  <div class="next-row">
    <a class="pe-next" href="/projects/data-spine/value">Next: the value — and eight ways of seeing it →</a>
  </div>
</div>

<style>
  .status-card { margin-top: 12px; border: 1px solid rgba(28,22,17,0.18); border-left: 3px solid var(--warn, #b0892a); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 12px 14px; }
  .status-card .st-label { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 4px; }
  .status-card b { font-family: 'Fraunces', serif; font-size: 16px; }
  .status-card p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 6px 0 8px; }

  .quotes { display: flex; flex-direction: column; gap: 14px; }
  .quote { margin: 0; border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 16px 18px; }
  .quote p { margin: 0 0 10px; font-family: 'Fraunces', serif; font-size: 17.5px; line-height: 1.5; color: var(--ink); }
  .quote footer { font-size: 11.5px; color: rgba(28,22,17,0.6); }
  .quote footer b { color: var(--ink); font-weight: 600; }
  .quote footer a { margin-left: 8px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .layers { display: flex; flex-direction: column; gap: 10px; }
  .layer { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 16px; }
  .layer-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .layer-no { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: var(--paper); background: var(--accent-ink); border-radius: var(--radius-sharp); padding: 1px 6px; }
  .layer-head b { font-family: 'Fraunces', serif; font-size: 16px; }
  .layer-q { font-size: 12.5px; color: rgba(28,22,17,0.55); font-style: italic; }
  .layer-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
  .layer-cols p { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 3px 0 0; }
  .layer-eli { font-size: 13.5px; line-height: 1.55; color: rgba(28,22,17,0.74); margin: 8px 0 0; }
  @media (max-width: 700px) { .layer-cols { grid-template-columns: 1fr; gap: 8px; } }

  .vs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .vs-card { border: 1.5px solid var(--accent-ink-tint-35); border-radius: var(--radius-round); background: var(--accent-ink-tint-06); padding: 14px 16px; }
  .vs-card.id-card { border-color: rgba(122,90,166,0.45); background: rgba(122,90,166,0.07); }
  .vs-card h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 17px; margin: 0 0 6px; }
  @media (max-width: 760px) { .vs { grid-template-columns: 1fr; } }

  .tl-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 8px; }
  .tl-key { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.6); }
  .tl-key i { width: 9px; height: 9px; border-radius: var(--radius-pill); display: inline-block; }

  .timeline { list-style: none; margin: 0; padding: 0 0 0 4px; position: relative; }
  .timeline::before { content: ''; position: absolute; left: 9px; top: 6px; bottom: 6px; width: 2px; background: rgba(28,22,17,0.14); }
  .tl-item { position: relative; display: flex; gap: 14px; padding: 0 0 16px 0; }
  .tl-dot { position: relative; z-index: 1; flex: 0 0 12px; width: 12px; height: 12px; border-radius: var(--radius-pill); margin-top: 4px; border: 2px solid var(--paper); }
  .tl-body { min-width: 0; }
  .tl-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .tl-date { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: rgba(28,22,17,0.55); }
  .tl-head b { font-family: 'Fraunces', serif; font-size: 15px; }
  .tl-tag { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid; border-radius: var(--radius-round); padding: 0 5px; }
  .tl-body p { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.72); margin: 3px 0 0; }
  .tl-body a { color: var(--accent-ink); text-decoration: none; }

  .next-row { margin: 26px 0 16px; }
</style>
