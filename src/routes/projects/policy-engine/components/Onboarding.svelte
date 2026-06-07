<script lang="ts">
  import { app } from '../lib/appState.svelte';

  const STEPS = [
    { n: '1', t: 'Set the policy', d: 'Open the <b>Levers</b> on the left and drag the sliders — or pick a ready-made <b>Scenario</b> from the bar at the top (e.g. “Attendance blitz”). The levers stay docked beside the data, so you can watch your changes land.' },
    { n: '2', t: 'Watch the outcomes', d: 'The scorecard up top and the charts on <b>Outcomes</b> update live: the disadvantage gap, attainment, the SEND funding cliff, absence and youth unemployment — your package versus doing nothing.' },
    { n: '3', t: 'Go deeper', d: '<b>Population</b> turns the results into real children and lifetime-earnings; <b>Regions</b> breaks them down by area; <b>Method</b> shows every calculation and source.' },
  ];

  // Record when the user last saw the modal so it re-shows on a later visit (but not on every
  // refresh during an active session). See the 15-minute window check in +layout.svelte.
  function markSeen() { try { localStorage.setItem('epm-onboarded-at', String(Date.now())); } catch { /* ignore */ } }
  function choose(mode: 'research' | 'eli5') {
    app.narrative = mode;
    try { localStorage.setItem('epm-narrative', mode); } catch { /* ignore */ }
    markSeen();
    app.showHelp = false;
  }
  function dismiss() { markSeen(); app.showHelp = false; }
</script>

{#if app.showHelp}
  <div class="ob-backdrop" role="presentation" onclick={dismiss}>
    <div class="ob" role="dialog" aria-modal="true" aria-label="How to use Education Policy Modelling" onclick={(e) => e.stopPropagation()}>
      <span class="ob-eyebrow">Field Study №4 · How to use it</span>
      <h2 class="ob-h">A flight simulator for England’s schools</h2>
      <p class="ob-lede">
        Move the policies a government actually controls and watch what happens to the disadvantage gap — and to real children —
        every year to 2040. It’s built on the research, and open about what nobody knows for sure.
      </p>

      <div class="ob-risk" role="note">
        <span class="risk-icon" aria-hidden="true">⚠</span>
        <p>
          I’ve used some personal knowledge, research methodology and coding to build this policy engine —
          <b>but a lot of AI has been used to support me, and I’m not a statistician.</b> This is a personal project, built in my own
          time: <b>it doesn’t represent the Department for Education, any government or party, or any official position</b>, and it takes
          no political stance. I built it to help me better understand the policy challenges, <b>so use it at your own risk.</b>
          <span class="sig">~ JK</span>
        </p>
      </div>

      <ol class="ob-steps">
        {#each STEPS as s}
          <li><span class="s-n">{s.n}</span><div><span class="s-t">{s.t}</span><span class="s-d">{@html s.d}</span></div></li>
        {/each}
      </ol>

      <div class="ob-choice">
        <span class="choice-q">First — how should I explain things to you?</span>
        <div class="choice-btns">
          <button class="choice eli5" onclick={() => choose('eli5')}>
            <b>In plain English</b><span>No jargon — like explaining it to a friend. (“ELI5”)</span>
          </button>
          <button class="choice research" onclick={() => choose('research')}>
            <b>Full research detail</b><span>The evidence, the sources and how the model works.</span>
          </button>
        </div>
        <span class="ob-note">You can switch any time with <b>“Explain it as”</b> at the top of every page, and reopen this from <b>? How to use</b>.</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .ob-backdrop { position: fixed; inset: 0; z-index: 300; background: rgba(28,22,17,0.42); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 22px; }
  .ob { width: min(580px, 100%); max-height: 92vh; overflow-y: auto; background: var(--paper, #f1ead6); border: 1px solid rgba(28,22,17,0.2);
    border-radius: 14px; box-shadow: 0 28px 70px -20px rgba(0,0,0,0.5); padding: 22px 24px; font-family: 'DM Sans', system-ui, sans-serif; }
  .ob-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .ob-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(22px, 3.2vw, 28px); line-height: 1.06; letter-spacing: -0.02em; margin: 7px 0 10px; color: var(--ink, #1c1611); }
  .ob-lede { margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: rgba(28,22,17,0.74); }

  /* the risk disclaimer — deliberately the loudest thing in the modal */
  .ob-risk { display: flex; gap: 12px; align-items: flex-start; margin: 0 0 18px; padding: 14px 16px; border-radius: 10px;
    background: rgba(177,69,94,0.1); border: 1.5px solid rgba(177,69,94,0.55); box-shadow: 0 2px 0 rgba(177,69,94,0.25); }
  .risk-icon { font-size: 22px; line-height: 1; color: #b1455e; flex-shrink: 0; margin-top: 1px; }
  .ob-risk p { margin: 0; font-size: 14px; line-height: 1.55; color: #6f2230; }
  .ob-risk b { color: #8a2d3a; font-weight: 700; }
  .sig { display: inline-block; margin-left: 4px; font-family: 'Fraunces', serif; font-style: italic; font-weight: 600; color: #6f2230; }

  .ob-steps { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 11px; }
  .ob-steps li { display: flex; gap: 12px; align-items: flex-start; }
  .s-n { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; background: var(--ink, #1c1611); color: var(--paper, #f1ead6);
    font-family: 'JetBrains Mono', monospace; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; }
  .s-t { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); margin-bottom: 1px; }
  .s-d { display: block; font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .s-d :global(b) { color: var(--ink, #1c1611); }

  .ob-choice { border-top: 1px solid rgba(28,22,17,0.12); padding-top: 14px; }
  .choice-q { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); margin-bottom: 10px; }
  .choice-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 480px) { .choice-btns { grid-template-columns: 1fr; } }
  .choice { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 12px 14px; border-radius: 10px; cursor: pointer;
    border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.5); transition: transform 0.1s, border-color 0.12s, background 0.12s; }
  .choice:hover { transform: translateY(-1px); }
  .choice b { font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--ink, #1c1611); }
  .choice span { font-size: 11.5px; line-height: 1.4; color: rgba(28,22,17,0.6); }
  .choice.eli5:hover { border-color: #3f7d6e; background: rgba(63,125,110,0.1); }
  .choice.research:hover { border-color: #2f6f97; background: rgba(47,111,151,0.08); }
  .ob-note { display: block; margin-top: 11px; font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.55); }
  .ob-note b { color: rgba(28,22,17,0.75); }
  @media (max-width: 560px) {
    .ob-backdrop { padding: 10px; align-items: flex-start; }
    .ob { padding: 16px 15px; max-height: 96vh; border-radius: 12px; }
    .ob-h { font-size: 21px; }
    .ob-risk { padding: 11px 12px; gap: 9px; } .risk-icon { font-size: 18px; }
    .ob-risk p, .ob-lede { font-size: 13px; }
  }
</style>
