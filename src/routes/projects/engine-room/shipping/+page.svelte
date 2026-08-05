<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import { PIPELINE, SAFETY, RISK_PATHS } from '../lib/shipping.js';
  import { app } from '../lib/appState.svelte';

  const eli = $derived(app.narrative === 'eli5');
  let st = $state(1);
</script>

<svelte:head>
  <title>Shipping — how a change reaches production · The Engine Room</title>
  <meta name="description" content="The gate-then-deploy pipeline that is the only route to production, the risk classifier that decides what a machine may merge by itself, and the incident that made the rules." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="Section 9 · Shipping"
    title="The only way in"
    thesis="There is exactly one route from a change to the live site, and it is not a habit or a checklist — it is a dependency between two jobs, so a failing test makes deployment physically unreachable rather than merely inadvisable. The genuinely interesting decision is further along: a machine-authored change is allowed to merge itself, but only if a classifier says it touches nothing that matters."
    thesisEli5="There is one way for a change to reach the live website, and it will not run if the tests fail — not because someone remembers to check, but because the step literally cannot start. The interesting bit is that small, safe changes written by the machine can go live on their own, while anything touching something important has to wait for a person."
    asks={[
      'How do you make a rule that cannot be forgotten rather than one that must be remembered?',
      'What is a machine allowed to merge without asking?',
      'What actually happened the one time this was done by hand?',
    ]}
  />

  <h2 class="pe-h2">Six stages</h2>
  <div class="pipe">
    {#each PIPELINE as p, i}
      <button class="stg" class:on={st === i} onclick={() => (st = i)}>
        <span class="s-n">{i + 1}</span>
        <span class="s-name">{p.name}</span>
        <span class="s-where">{p.where}</span>
      </button>
    {/each}
  </div>
  <div class="stg-detail">
    <span class="sd-lab">{PIPELINE[st].name} · <i>{PIPELINE[st].where}</i></span>
    <p class="sd-what">{eli ? PIPELINE[st].eli5 : PIPELINE[st].what}</p>
    <p class="sd-why"><b>Why it is shaped this way:</b> {PIPELINE[st].why}</p>
  </div>

  <h2 class="pe-h2">What a machine may merge by itself</h2>
  <p class="pe-prose" style="max-width:82ch">
    {#if eli}
      The system can write its own improvements and, for small safe ones, put them live without asking. "Small and
      safe" is not a judgement call — it is decided by which files the change touches, from a list written in
      advance.
    {:else}
      This is the real boundary of autonomy in the system, and it is drawn by file path rather than by anyone's
      assessment in the moment. Touching any of these makes a change high tier, which never auto-merges:
    {/if}
  </p>
  <div class="paths">
    {#each RISK_PATHS as r}
      <div class="pth"><b>{r.group}</b><span>{r.why}</span></div>
    {/each}
  </div>
  <div class="er-lesson">
    <span class="el-lab">The line that matters most</span>
    <p>The last entry is the important one. The agent's own sandbox, its confirmation gate and its tool deny-list are
      all protected paths — so a change that would <b>widen the machine's own permissions</b> can never be merged by
      the machine. It can propose it, write it, and argue for it in the pull request. A person has to agree.</p>
    <p>Note also that the classifier <b>never fails the build</b>. A high tier is a normal outcome, not an error: it
      means "a human looks at this". Making it a failure would train everyone to route around it.</p>
  </div>

  <h2 class="pe-h2">Five rules, four of them written by an incident</h2>
  <div class="ds-grid two">
    {#each SAFETY as s}
      <div class="ds-card">
        <h3>{s.title}</h3>
        <p class="ds-body">{s.body}</p>
      </div>
    {/each}
  </div>

  <div class="er-lesson">
    <span class="el-lab">This page tripped one of its own checks</span>
    <p>Adding this study created four routes reachable without signing in. The gate failed, printed exactly which
      four had become public, and refused to go green until that change was acknowledged and committed. That is the
      check working — and it is a better design than a code review, because a reviewer skims a diff of hundreds of
      lines while <b>this compares the actual reachable surface before and after</b> and shows only what changed
      about it.</p>
  </div>

  <a class="pe-next" href="/projects/engine-room/guardrails">Next — the whole security model →</a>
</section>

<style>
  .pipe { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 7px; margin: 14px 0 0; }
  .stg { display: flex; flex-direction: column; gap: 2px; text-align: left; cursor: pointer;
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
    padding: 9px 12px; transition: background 0.12s, border-color 0.12s; }
  .stg:hover { background: rgba(255,255,255,0.82); border-color: rgba(28,22,17,0.36); }
  .stg.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .s-n { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent); font-weight: 600; }
  .s-name { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .s-where { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }
  .stg.on .s-n { color: #ffd9b8; }
  .stg.on .s-name { color: #fff; }
  .stg.on .s-where { color: rgba(255,255,255,0.65); }

  .stg-detail { margin-top: 9px; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 11px 14px; }
  .sd-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .sd-lab i { font-style: normal; color: rgba(28,22,17,0.5); }
  .sd-what { margin: 5px 0 7px; font-size: 14px; line-height: 1.56; color: var(--text-primary); max-width: 88ch; }
  .sd-why { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.7); max-width: 88ch;
    padding-top: 7px; border-top: 1px solid rgba(28,22,17,0.1); }
  .sd-why b { color: var(--text-primary); }

  .paths { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 8px; margin: 14px 0; }
  .pth { border: 1px solid rgba(138,45,58,0.28); border-radius: var(--radius-round); background: rgba(138,45,58,0.05); padding: 9px 12px; }
  .pth b { display: block; font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: #8a2d3a; }
  .pth span { display: block; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.65); margin-top: 2px; }
</style>
