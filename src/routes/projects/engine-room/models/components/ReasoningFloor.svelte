<script lang="ts">
  // ReasoningFloor — drag the output budget and watch the answer disappear.
  //
  // The two endpoints are measured on the site default model: at a budget of 50 the call
  // returns finish_reason 'length', 50 reasoning tokens and an EMPTY string; at 3,000 it
  // returns 'stop', 447 reasoning tokens and the one-word answer. Everything between is
  // interpolated from the fact that reasoning is emitted first and demands ~447 tokens.

  const DEMAND = 447;        // measured reasoning tokens for this one-word classification
  const FLOOR = 3000;        // the guard the gateway now applies centrally
  const ANSWER = 'tool';

  let budget = $state(50);

  const spentOnReasoning = $derived(Math.min(budget, DEMAND));
  const leftForAnswer = $derived(Math.max(0, budget - DEMAND));
  const truncated = $derived(budget < DEMAND);
  const finish = $derived(truncated ? 'length' : 'stop');
  const output = $derived(truncated ? '' : ANSWER);
  const pctReasoning = $derived((spentOnReasoning / Math.max(budget, 1)) * 100);
</script>

<div class="rf">
  <div class="rf-head">
    <span class="k">Output budget · <code>max_tokens</code></span>
    <b class="val">{budget.toLocaleString()}</b>
  </div>

  <input class="slider" type="range" min="20" max="3000" step="10" bind:value={budget}
         aria-label="Output token budget" />

  <div class="ticks">
    <span>20</span>
    <span class="mark" style="left:{((DEMAND - 20) / (3000 - 20)) * 100}%">{DEMAND} — what it actually needs to think</span>
    <span class="end">3,000</span>
  </div>

  <div class="bar" aria-hidden="true">
    <span class="seg reasoning" style="width:{pctReasoning}%"></span>
    <span class="seg answer" style="width:{100 - pctReasoning}%"></span>
  </div>
  <div class="legend">
    <span><i class="sw reasoning"></i>reasoning — invisible, billed, emitted first ({spentOnReasoning} tok)</span>
    <span><i class="sw answer"></i>left for the answer ({leftForAnswer} tok)</span>
  </div>

  <div class="out" class:bad={truncated}>
    <div class="o-row">
      <span class="o-k">finish_reason</span>
      <code class="o-v" class:bad={truncated}>{finish}</code>
    </div>
    <div class="o-row">
      <span class="o-k">content</span>
      {#if output}
        <code class="o-v good">"{output}"</code>
      {:else}
        <code class="o-v bad">"" <em>— empty string, no error thrown</em></code>
      {/if}
    </div>
    <p class="o-say">
      {#if truncated}
        The model spent the entire budget on reasoning it never got to show you, and returned nothing. Nothing raised.
        Nothing logged as a failure. Downstream, this reads as <b>“the model is being unhelpful”</b> rather than
        <b>“the request was malformed”</b> — which is why it costs days to find.
      {:else}
        A one-word answer, after {DEMAND} tokens of invisible reasoning you paid for. The visible output is four
        characters; the bill is four hundred and fifty tokens.
      {/if}
    </p>
  </div>

  <p class="rf-foot">
    The fix is central, not per-call-site: any request routed to a reasoning-capable model has its budget raised to a
    floor of <b>{FLOOR.toLocaleString()}</b> on the way out. New call sites inherit the guard, and new reasoning models
    do not each rediscover the bug. In the catalogue snapshot, <b>76</b> models advertise a completion ceiling below the
    default workflow budget — so the opposite mistake is available too.
  </p>
</div>

<style>
  .rf { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .rf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .k code { font-size: 10px; background: none; padding: 0; }
  .val { font-family: 'JetBrains Mono', monospace; font-size: 19px; font-weight: 600; color: var(--text-primary); }

  .slider { width: 100%; margin: 9px 0 2px; accent-color: var(--accent-ink); }
  .ticks { position: relative; height: 22px; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }
  .ticks .end { position: absolute; right: 0; }
  .ticks .mark { position: absolute; white-space: nowrap; color: var(--accent); transform: translateX(-50%); }
  .ticks .mark::before { content: ''; position: absolute; left: 50%; top: -14px; width: 1px; height: 11px; background: var(--accent); }

  .bar { display: flex; height: 22px; border-radius: var(--radius-sharp); overflow: hidden; border: 1px solid rgba(28,22,17,0.14); margin-top: 4px; }
  .seg { transition: width 0.15s linear; }
  .seg.reasoning { background: rgba(180,99,46,0.5); }
  .seg.answer { background: rgba(45,122,58,0.32); }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 6px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.6); }
  .sw { width: 9px; height: 9px; border-radius: var(--radius-sharp); }
  .sw.reasoning { background: rgba(180,99,46,0.5); }
  .sw.answer { background: rgba(45,122,58,0.32); }

  .out { margin-top: 12px; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.6); padding: 10px 13px; }
  .out.bad { border-color: rgba(196,68,68,0.4); background: rgba(196,68,68,0.05); }
  .o-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 5px; }
  .o-k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.5); min-width: 92px; }
  .o-v { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(28,22,17,0.06); padding: 2px 7px; border-radius: var(--radius-sharp); }
  .o-v.good { color: #2d7a3a; background: rgba(45,122,58,0.11); }
  .o-v.bad { color: #c44; background: rgba(196,68,68,0.1); }
  .o-v em { font-style: normal; font-size: 10px; color: rgba(28,22,17,0.55); }
  .o-say { margin: 8px 0 0; font-size: 12.5px; line-height: 1.58; color: rgba(28,22,17,0.76); max-width: 84ch; padding-top: 7px; border-top: 1px solid rgba(28,22,17,0.08); }
  .o-say b { color: var(--text-primary); }
  .rf-foot { margin: 11px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .rf-foot b { color: rgba(28,22,17,0.82); }
</style>
