<script lang="ts">
  // VerifyGate — try to get an LLM-authored handler past the scan.
  //
  // The point being made: handlers are compiled with an async function constructor in full
  // Node scope, so this deny-list is not one layer of defence among several. It is the only
  // thing between generated text and the environment. Every violation is reported, not just
  // the first — one repair round can then fix them all instead of playing whack-a-mole.
  //
  // The frame, the reading line and the map of the deny-list all live on the page now, so
  // this component is only the console. The constants' verdicts below are compressed
  // wording of the `verdict` field in lib/building.ts — shorter, never a different claim.
  import { CANDIDATES, FORBIDDEN, type Candidate } from '../../../lib/building';

  let pick = $state<Candidate>(CANDIDATES[0]);
  let ran = $state(false);

  const violations = $derived(FORBIDDEN.filter((f) => pick.trips.includes(f.pat)));
  const scanOk = $derived(violations.length === 0);
  const smokeOk = $derived(pick.smoke === 'pass');
  const admitted = $derived(scanOk && smokeOk);

  /** The `verdict` field of each candidate in lib/building.ts, compressed. No fact changed. */
  const VERDICT: Record<string, string> = {
    ok: 'Clean scan, every case passes. Registered live — no restart, no approval step.',
    env: 'Rejected before compilation. Probably innocent — but a handler that can read one environment variable can read every secret the process holds, and the scan cannot tell intent from text.',
    escape: 'Two violations, both reported. Handlers compile in full Node scope, so this scan is the only thing in the way.',
    obfus: 'Rejected. Base64 is harmless in itself, which is how a payload gets past a scan that only looks for the dangerous word.',
    leak: 'Rejected. Not malicious, just wrong: work scheduled to outlive its own call leaks a timer every time it runs.',
    flaky: 'Scan clean; one smoke case returns NaN. Not registered. The failure text feeds tomorrow night’s authoring call.',
  };

  function choose(c: Candidate) {
    pick = c;
    ran = false;
  }
</script>

<div class="vg">
  <div class="vg-picks" role="group" aria-label="Candidate handler">
    {#each CANDIDATES as c (c.id)}
      <button class:on={pick.id === c.id} aria-pressed={pick.id === c.id} onclick={() => choose(c)}>{c.label}</button>
    {/each}
  </div>

  <div class="vg-body">
    <div class="vg-code">
      <span class="c-lab">Candidate · <i>{pick.intent}</i></span>
      <pre>{pick.code}</pre>
      <button class="run" onclick={() => (ran = true)} disabled={ran}
        >{#if !ran}<span aria-hidden="true">▶</span>{/if}{ran ? 'run complete' : 'run the gate'}</button
      >
    </div>

    <div class="vg-result" class:shown={ran} aria-live="polite">
      {#if !ran}
        <p class="idle">Press <b>run the gate</b>. Two checks, in order.</p>
      {:else}
        <div class="step" class:pass={scanOk} class:fail={!scanOk}>
          <span class="s-n">1</span>
          <span class="s-name">Static scan<em>raw source, before compilation</em></span>
          <span class="s-verdict"
            >{scanOk ? 'clean' : `${violations.length} violation${violations.length > 1 ? 's' : ''}`}</span
          >
        </div>
        {#if violations.length}
          <ul class="viol">
            {#each violations as v (v.pat)}
              <li><code>{v.pat}</code>{v.why}</li>
            {/each}
          </ul>
        {/if}

        <div
          class="step"
          class:pass={smokeOk}
          class:fail={pick.smoke === 'fail'}
          class:skip={pick.smoke === 'n/a'}
        >
          <span class="s-n">2</span>
          <span class="s-name">Smoke test<em>every case, not most</em></span>
          <span class="s-verdict"
            >{pick.smoke === 'n/a' ? 'not reached' : pick.smoke === 'pass' ? 'all pass' : 'a case failed'}</span
          >
        </div>

        <div class="final" class:in={admitted}>
          <span class="f-lab"
            ><span aria-hidden="true">{admitted ? '✓' : '✕'}</span>{admitted ? 'Registered live' : 'Rejected'}</span
          >
          <p>{VERDICT[pick.id] ?? pick.verdict}</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .vg { display: flex; flex-direction: column; gap: 11px; }

  .vg-picks { display: flex; gap: 6px; flex-wrap: wrap; }
  .vg-picks button { font-family: 'DM Sans', sans-serif; font-size: 12.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 6px 12px; cursor: pointer; transition: background 0.12s, border-color 0.12s; }
  .vg-picks button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .vg-picks button.on { background: #8a2d3a; border-color: #8a2d3a; color: #fff; }

  .vg-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .vg-code { display: flex; flex-direction: column; min-width: 0; }
  .c-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.09em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .c-lab i { font-style: normal; text-transform: none; letter-spacing: 0; color: rgba(28,22,17,0.7); }
  .vg-code pre { margin: 6px 0 8px; padding: 11px 13px; background: var(--code-bg); color: var(--code-text);
    border-radius: var(--radius-round); font-family: 'JetBrains Mono', monospace; font-size: 11px;
    line-height: 1.55; overflow-x: auto; white-space: pre; }
  .run { align-self: flex-start; font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600;
    color: #fff; background: #8a2d3a; border: none; border-radius: var(--radius-round);
    padding: 8px 16px; cursor: pointer; }
  .run span { margin-right: 6px; }
  .run:disabled { opacity: 0.45; cursor: default; }

  .vg-result { border: 1px dashed rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 11px 13px; min-width: 0; min-height: 150px; }
  .vg-result.shown { border-style: solid; background: rgba(255,255,255,0.55); }
  .idle { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.55); }
  .idle b { color: var(--text-primary); }

  .step { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center;
    padding: 7px 9px; border-radius: var(--radius-round); margin-bottom: 6px; background: rgba(28,22,17,0.04); }
  .step.pass { background: color-mix(in srgb, var(--success) 10%, transparent); }
  .step.fail { background: color-mix(in srgb, var(--error) 10%, transparent); }
  .step.skip { background: rgba(28,22,17,0.05); opacity: 0.7; }
  .s-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; color: rgba(28,22,17,0.5);
    background: rgba(255,255,255,0.7); border-radius: var(--radius-pill); text-align: center; padding: 2px 0; }
  .s-name { display: flex; flex-direction: column; gap: 1px; min-width: 0;
    font-size: 12.5px; font-weight: 500; color: var(--text-primary); line-height: 1.25; }
  .s-name em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .s-verdict { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.62); }
  .step.pass .s-verdict { color: var(--success); }
  .step.fail .s-verdict { color: var(--error); }

  .viol { margin: 0 0 8px; padding-left: 30px; list-style: none; }
  .viol li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.7); margin-bottom: 3px; }
  .viol code { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, transparent); padding: 1px 5px;
    border-radius: var(--radius-sharp); margin-right: 6px; }

  .final { margin-top: 9px; padding: 9px 12px; border-radius: var(--radius-round);
    background: var(--error-bg); border-left: 3px solid var(--error); }
  .final.in { background: var(--success-bg); border-left-color: var(--success); }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; color: var(--error); }
  .f-lab span { margin-right: 5px; }
  .final.in .f-lab { color: var(--success); }
  .final p { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); }
</style>
