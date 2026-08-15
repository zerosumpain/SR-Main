<script lang="ts">
  // NEXT STEPS — the forward-looking close of the study: the road from a one-paragraph
  // commitment to a running system, the design decisions the consultation must make,
  // and the standards nobody has written yet.
  import { app } from '../lib/appState.svelte';
  import { STATUS, TIMELINE } from '../lib/spine';
  import { STANDARDS, OPEN_DECISIONS } from '../lib/standards';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';

  const eli = $derived(app.narrative === 'eli5');
  // the road ahead: everything from the consultation onward
  const AHEAD = TIMELINE.filter((t) => t.year >= 2026 && (t.date.includes('Summer') || t.title.toLowerCase().includes('consultation') || t.title.toLowerCase().includes('implementation')));
</script>

<svelte:head>
  <title>The Data Spine — what happens next</title>
  <meta name="description" content="The data spine from a one-paragraph white-paper commitment to a running system: the consultation and implementation timeline, the architectural decisions still open, and the standards — above all a published identity-resolution standard — nobody has written yet." />
</svelte:head>

<div class="pe-route">
  <StoryMasthead
    kicker="Field study · The Data Spine · Next steps"
    title="What happens next"
    thesis="The spine is one paragraph of commitment and a consultation yet to open. This closing section maps the road from here to a running system — the timeline, the decisions the consultation is left to make, and the standards that would have to exist before a single real query crosses a real exchange. None of it is blocked by technology. All of it is blocked by agreement."
    thesisEli5="The government has promised the spine but not designed it. Here’s what has to happen next: a consultation, a set of big decisions nobody has made yet, and a pile of rules nobody has written — starting with how you know two services are talking about the same child."
    asks={[
      'What is the sequence from the summer-2026 consultation to 2028–29 implementation?',
      'Which design decisions are genuinely still open — and which way do the precedents point?',
      'What would actually have to be standardised first? (The identity-resolution standard above all.)',
    ]}
    askLabel="What this section answers" />

  <!-- The road ahead -->
  <StorySection title="From a paragraph to a system">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          The spine is a promise with a date attached: consult in summer 2026, build toward 2028–29. Everything
          about how it works gets decided in that window — which is why the consultation matters more than the announcement.
        {:else}
          {STATUS.detail} The consistent identifier is already law (CWSA 2026); the spine is not. The two are steered
          together but decided separately — and the architecture question the white paper ducked is precisely what the
          consultation exists to answer.
        {/if}
      </p>
      <div class="status-card">
        <span class="st-label">Status</span>
        <b>{STATUS.headline}</b>
        <p>{eli ? STATUS.eli5 : STATUS.detail}</p>
      </div>
    {/snippet}
    {#snippet data()}
      <ol class="ahead">
        {#each AHEAD as t}
          <li>
            <span class="ah-date">{t.date}</span>
            <div class="ah-body"><b>{t.title}</b><p>{t.detail}</p></div>
          </li>
        {/each}
        <li class="ah-open">
          <span class="ah-date">2028–29</span>
          <div class="ah-body"><b>Full implementation (white-paper phasing)</b><p>The target the white paper sets itself — three-plus years from a commitment with, as yet, no published architecture, custodian, budget or standard.</p></div>
        </li>
      </ol>
    {/snippet}
  </StorySection>

  <!-- Open decisions -->
  <StorySection title="The decisions still open">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          These are the questions nobody has answered yet. The first one — copy the data into one database, or leave
          it in schools and fetch it — is the one everything else depends on, and the one Britain already got wrong once.
        {:else}
          The consultation inherits a set of forks the white paper left open. They are ranked here by how much rides on
          them: the custody question first, because it is the only one with a proven English failure mode, then the
          resolution standard the <a href="/projects/data-spine/federation/sim">simulation</a> makes unavoidable.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="decisions">
        {#each OPEN_DECISIONS as d, i}
          <div class="dec">
            <div class="dec-head"><span class="dec-no">{i + 1}</span><h3>{d.question}</h3></div>
            {#if eli}
              <p class="dec-eli">{d.eli5}</p>
            {:else}
              <p class="dec-fork"><span class="dl">The fork</span>{d.fork}</p>
              <p class="dec-read"><span class="dl">Our read</span>{d.read}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <!-- Standards stack -->
  <StorySection title="The standards still to be written">
    {#snippet prose()}
      <p class="pe-prose">
        {#if eli}
          For all these systems to talk to each other, everyone has to agree the rules first: how to name a child once,
          how to describe a record, how to ask a question, how to prove who asked, how to say no, and why anyone would
          bother joining. Some rules exist. The interesting column is what’s missing.
        {:else}
          Nothing on the spine is blocked by cryptography; all of it is blocked by <b>agreement</b> — six layers of
          standards, each with pieces that already exist and pieces nobody has written. The pattern to steal is
          procedural: X-Road’s protocol and trust rules are open and versioned; Ed-Fi and 1EdTech publish conformance
          suites vendors certify against. England has schemas and circulars — what it lacks is the registry, the
          contract format, and the certification loop that make standards enforceable at a gateway.
        {/if}
      </p>
    {/snippet}
    {#snippet data()}
      <div class="std-grid">
        {#each STANDARDS as s}
          <div class="std-card">
            <span class="std-k">{s.k}</span>
            <h3>{s.title}</h3>
            <div class="std-col have">
              <span class="std-h">Exists today</span>
              <ul>{#each s.have as item}<li>{item}</li>{/each}</ul>
            </div>
            <div class="std-col miss">
              <span class="std-h">Missing</span>
              <ul>{#each s.miss as item}<li>{item}</li>{/each}</ul>
            </div>
          </div>
        {/each}
      </div>
    {/snippet}
  </StorySection>

  <div class="close">
    <p>That is the whole study: a problem defined, its sources laid out, the solutions compared, a model recommended,
      its outcomes and governance examined, and the road ahead marked. The one paragraph on page 98 has a great deal
      still to decide — and a great deal already known about how it tends to go.</p>
    <div class="close-row">
      <a class="pe-next" href="/projects/data-spine/federation/sim">Replay the model, live →</a>
      <a class="pe-back" href="/projects/data-spine">↑ Back to the problem</a>
    </div>
  </div>
</div>

<style>
  .status-card { margin-top: 12px; border: 1px solid rgba(28,22,17,0.18); border-left: 3px solid var(--warn, #b0892a); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.5); padding: 12px 14px; }
  .status-card .st-label { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 4px; }
  .status-card b { font-family: var(--fs-serif); font-size: var(--fs-body); }
  .status-card p { font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); margin: 6px 0 0; }

  .ahead { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .ahead li { display: flex; gap: 14px; border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 11px 14px; }
  .ahead li.ah-open { border-left-color: var(--warn, #b0892a); border-style: dashed; }
  .ah-date { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink); flex: 0 0 82px; padding-top: 2px; }
  .ah-body { min-width: 0; }
  .ah-body b { font-family: var(--fs-serif); font-size: var(--fs-body-sm); }
  .ah-body p { font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.72); margin: 3px 0 0; }

  .decisions { display: flex; flex-direction: column; gap: 12px; }
  .dec { border: 1px solid rgba(28,22,17,0.18); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 14px 16px; }
  .dec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
  .dec-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--paper); background: var(--ink); border-radius: var(--radius-sharp); padding: 1px 7px; }
  .dec-head h3 { font-family: var(--fs-serif); font-weight: 600; font-size: 18px; margin: 0; }
  .dec-fork, .dec-read, .dec-eli { font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.78); margin: 6px 0 0; }
  .dl { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 2px; }
  .dec-read .dl { color: var(--accent-ink); }
  .dec-read { color: var(--ink); }

  .std-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .std-card { border: 1px solid rgba(28,22,17,0.18); border-top: 3px solid var(--accent-ink-tint-35, rgba(14,91,102,0.35)); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 16px 18px; min-width: 0; }
  .std-k { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.22em; color: var(--accent-ink); margin-bottom: 4px; }
  .std-card h3 { font-family: var(--fs-serif); font-weight: 600; font-size: 18px; line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 12px; }
  .std-col { margin-bottom: 10px; }
  .std-h { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
  .std-col.have .std-h { color: #2f7d4f; }
  .std-col.miss .std-h { color: #8a2d3a; }
  .std-col ul { list-style: none; margin: 0; padding: 0; }
  .std-col li { font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.74); padding: 2px 0 2px 14px; position: relative; }
  .std-col.have li::before { content: '·'; position: absolute; left: 2px; color: #2f7d4f; font-weight: 700; }
  .std-col.miss li::before { content: '·'; position: absolute; left: 2px; color: #8a2d3a; font-weight: 700; }
  .std-col.miss li { color: rgba(28,22,17,0.82); }

  .close { margin: 30px 0 10px; border-top: 1px solid rgba(28,22,17,0.14); padding-top: 20px; }
  .close p { font-size: var(--fs-body-sm); line-height: 1.6; color: rgba(28,22,17,0.8); max-width: 80ch; }
  .close-row { display: flex; gap: 18px; align-items: baseline; margin-top: 14px; flex-wrap: wrap; }
  .pe-back { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; color: rgba(28,22,17,0.6); text-decoration: none; }
  .pe-back:hover { color: var(--ink); }
</style>
