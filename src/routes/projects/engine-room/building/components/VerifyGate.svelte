<script lang="ts">
  // VerifyGate — try to get an LLM-authored handler past the scan.
  //
  // The point being made: handlers are compiled in full Node scope, so this deny-list is
  // not one layer among several. It is the only thing between generated text and the
  // environment. Every violation is reported, not just the first — one repair round can
  // then fix them all instead of playing whack-a-mole.
  import { CANDIDATES, FORBIDDEN, type Candidate } from '../../lib/building';

  let pick = $state<Candidate>(CANDIDATES[0]);
  let ran = $state(false);

  const violations = $derived(FORBIDDEN.filter((f) => pick.trips.includes(f.pat)));
  const scanOk = $derived(violations.length === 0);
  const smokeOk = $derived(pick.smoke === 'pass');
  const admitted = $derived(scanOk && smokeOk);

  function choose(c: Candidate) { pick = c; ran = false; }
</script>

<div class="vg">
  <div class="vg-head">
    <span class="k">The gate · every candidate must clear both</span>
    <p>The engine writes a tool. Before that tool exists as far as the running system is concerned, it has to survive
      a deny-list scan over its raw source and a smoke test in which <b>every</b> case passes — not most. Pick a
      candidate and run it.</p>
  </div>

  <div class="vg-picks" role="group" aria-label="Candidate handler">
    {#each CANDIDATES as c}
      <button class:on={pick.id === c.id} onclick={() => choose(c)}>{c.label}</button>
    {/each}
  </div>

  <div class="vg-body">
    <div class="vg-code">
      <span class="c-lab">Candidate · <i>{pick.intent}</i></span>
      <pre>{pick.code}</pre>
      <button class="run" onclick={() => (ran = true)} disabled={ran}>{ran ? 'gate run' : '▶ run the gate'}</button>
    </div>

    <div class="vg-result" class:shown={ran}>
      {#if !ran}
        <p class="idle">Press <b>run the gate</b>. Two checks, in order — the scan happens before the code is ever
          compiled, so a rejected handler is never executed even once.</p>
      {:else}
        <div class="step" class:pass={scanOk} class:fail={!scanOk}>
          <span class="s-n">1</span>
          <span class="s-name">Static scan</span>
          <span class="s-verdict">{scanOk ? 'clean' : `${violations.length} violation${violations.length > 1 ? 's' : ''}`}</span>
        </div>
        {#if violations.length}
          <ul class="viol">
            {#each violations as v}
              <li><code>{v.pat}</code> — {v.why}</li>
            {/each}
          </ul>
        {/if}

        <div class="step" class:pass={smokeOk} class:fail={pick.smoke === 'fail'} class:skip={pick.smoke === 'n/a'}>
          <span class="s-n">2</span>
          <span class="s-name">Smoke test</span>
          <span class="s-verdict">{pick.smoke === 'n/a' ? 'not reached' : pick.smoke === 'pass' ? 'all cases pass' : 'a case failed'}</span>
        </div>

        <div class="final" class:in={admitted}>
          <span class="f-lab">{admitted ? '✓ Registered live' : '✕ Rejected'}</span>
          <p>{pick.verdict}</p>
        </div>
      {/if}
    </div>
  </div>

  <details class="denylist">
    <summary>The full deny-list — {FORBIDDEN.length} patterns</summary>
    <ul>
      {#each FORBIDDEN as f}
        <li><code>{f.pat}</code><span>{f.why}</span></li>
      {/each}
    </ul>
    <p class="dl-note">Deny beats allow: an unknown construct is refused rather than permitted. The list is
      deliberately blunt — <code>process</code> as a bare word catches environment access, exit and argv in one, at the
      cost of occasionally rejecting something harmless. That trade is the right way round when the alternative is a
      handler with the run-time's full privileges.</p>
  </details>
</div>

<style>
  .vg { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .vg-head p { margin: 5px 0 10px; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }
  .vg-head b { color: var(--text-primary); }

  .vg-picks { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 11px; }
  .vg-picks button { font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 6px 12px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .vg-picks button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .vg-picks button.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }

  .vg-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 12px; }
  .vg-code { display: flex; flex-direction: column; }
  .c-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .c-lab i { font-style: normal; text-transform: none; letter-spacing: 0; color: rgba(28,22,17,0.7); }
  .vg-code pre { margin: 6px 0 8px; padding: 11px 13px; background: #1c1611; color: #ede4d4; border-radius: var(--radius-round);
    font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.55; overflow-x: auto; white-space: pre; }
  .run { align-self: flex-start; font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: #fff;
    background: var(--accent); border: none; border-radius: var(--radius-round); padding: 8px 16px; cursor: pointer; }
  .run:disabled { opacity: 0.45; cursor: default; }

  .vg-result { border: 1px dashed rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 11px 13px; min-height: 150px; }
  .vg-result.shown { border-style: solid; background: rgba(255,255,255,0.55); }
  .idle { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.55); }
  .idle b { color: var(--text-primary); }

  .step { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; padding: 7px 9px;
    border-radius: var(--radius-round); margin-bottom: 6px; background: rgba(28,22,17,0.04); }
  .step.pass { background: rgba(45,122,58,0.1); }
  .step.fail { background: rgba(196,68,68,0.1); }
  .step.skip { background: rgba(28,22,17,0.05); opacity: 0.7; }
  .s-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: rgba(28,22,17,0.5);
    background: rgba(255,255,255,0.7); border-radius: var(--radius-pill); text-align: center; padding: 2px 0; }
  .s-name { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
  .s-verdict { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.62); }
  .step.pass .s-verdict { color: #2d7a3a; }
  .step.fail .s-verdict { color: #c44; }

  .viol { margin: 0 0 8px; padding-left: 30px; list-style: none; }
  .viol li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.7); margin-bottom: 3px; }
  .viol code { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: #c44; background: rgba(196,68,68,0.1);
    padding: 1px 5px; border-radius: var(--radius-sharp); margin-right: 5px; }

  .final { margin-top: 9px; padding: 9px 12px; border-radius: var(--radius-round); background: rgba(196,68,68,0.07);
    border-left: 3px solid #c44; }
  .final.in { background: rgba(45,122,58,0.08); border-left-color: #2d7a3a; }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; color: #c44; }
  .final.in .f-lab { color: #2d7a3a; }
  .final p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); }

  .denylist { margin-top: 12px; }
  .denylist summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.09em;
    text-transform: uppercase; color: var(--accent-ink); padding: 4px 0; }
  .denylist ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 4px 16px; }
  .denylist li { display: flex; gap: 8px; align-items: baseline; font-size: 11.5px; color: rgba(28,22,17,0.68); }
  .denylist li code { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--text-primary);
    background: rgba(28,22,17,0.07); padding: 1px 5px; border-radius: var(--radius-sharp); white-space: nowrap; }
  .dl-note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.6); max-width: 92ch; }
  .dl-note code { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; background: rgba(28,22,17,0.07); padding: 1px 4px; border-radius: var(--radius-sharp); }
</style>
