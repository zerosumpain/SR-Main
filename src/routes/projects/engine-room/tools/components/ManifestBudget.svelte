<script lang="ts">
  // ManifestBudget — the single switch that makes the argument: show the model everything,
  // or show it a curated twenty plus one door to the rest. The bar is to scale.
  import { MANIFEST, TIERS } from '../../lib/tools';

  let showAll = $state(false);

  const tokens = $derived(showAll ? MANIFEST.fullTokens : MANIFEST.servedTokens);
  const bytes = $derived(showAll ? MANIFEST.fullBytes : MANIFEST.servedBytes);
  const visible = $derived(showAll ? MANIFEST.registered : MANIFEST.shown);
  const pct = $derived((tokens / MANIFEST.fullTokens) * 100);
  const promptPct = $derived((tokens / MANIFEST.medianPrompt) * 100);
</script>

<div class="mb">
  <div class="mb-head">
    <div>
      <span class="k">The tool manifest · re-sent on every turn, before you type a word</span>
      <p>Every tool a model may call has to be described to it in full — name, prose, and a schema for its arguments.
        That description is prefilled on <b>every single message</b>, including “hi”.</p>
    </div>
    <button class="tog" class:on={showAll} onclick={() => (showAll = !showAll)}>
      <span class="t-state">{showAll ? 'Showing all 155' : 'Showing 21'}</span>
      <span class="t-sw" aria-hidden="true"><i></i></span>
      <span class="t-hint">{showAll ? 'click to curate' : 'click to show everything'}</span>
    </button>
  </div>

  <div class="meter">
    <div class="bar">
      <span class="fill" class:hot={showAll} style="width:{pct}%"></span>
      <span class="cap">full catalogue — {MANIFEST.fullTokens.toLocaleString()} tokens</span>
    </div>
    <div class="read">
      <div class="r"><b>{visible}</b><span>tool definitions the model sees</span></div>
      <div class="r"><b>≈{tokens.toLocaleString()}</b><span>tokens of prefill</span></div>
      <div class="r"><b>{bytes.toLocaleString()}</b><span>bytes serialised</span></div>
      <div class="r hi"><b>{promptPct.toFixed(0)}%</b><span>of a median prompt</span></div>
    </div>
  </div>

  <div class="verdict" class:hot={showAll}>
    {#if showAll}
      <p><b>Every turn pays {MANIFEST.fullTokens.toLocaleString()} tokens before the conversation starts.</b> Against a
        median prompt of {MANIFEST.medianPrompt.toLocaleString()} tokens, the tool list alone is most of the budget —
        and time-to-first-token scales close to linearly with prompt size, so this is latency as well as money.</p>
    {:else}
      <p><b>{MANIFEST.savedTokens.toLocaleString()} tokens saved on every single turn</b>, at a cost of
        {MANIFEST.dispatcherTokens} tokens for the dispatcher that hides the other {MANIFEST.hidden}. The capability is
        unchanged — the model can still reach all {MANIFEST.registered} tools. It simply pays for the ones it uses,
        when it uses them.</p>
    {/if}
  </div>

  <div class="tiers">
    {#each TIERS as t}
      <div class="tier">
        <span class="ti-h"><b>{t.tier}</b><em>{t.cost}</em></span>
        <p class="ti-what">{t.what}</p>
        <p class="ti-why">{t.why}</p>
      </div>
    {/each}
  </div>

  <p class="mb-foot">
    The discovery overhead turned out to be small: of the calls through the dispatcher, roughly
    <b>86% go straight to invoke</b> — the model mostly already knows what it wants and does not need to browse.
    That is the number that decides whether this design is clever or merely indirect.
  </p>
</div>

<style>
  .mb { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .mb-head { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-bottom: 12px; }
  .mb-head > div { flex: 1 1 300px; min-width: 0; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .mb-head p { margin: 5px 0 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 58ch; }
  .mb-head b { color: var(--text-primary); }

  .tog { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; background: none; border: none; padding: 4px; }
  .t-state { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--text-primary); }
  .t-sw { display: block; width: 52px; height: 26px; border-radius: var(--radius-pill); background: rgba(45,122,58,0.3);
    border: 1px solid rgba(28,22,17,0.2); position: relative; transition: background 0.18s; }
  .tog.on .t-sw { background: rgba(196,68,68,0.4); }
  .t-sw i { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: var(--radius-pill);
    background: #fff; transition: left 0.18s; }
  .tog.on .t-sw i { left: 28px; }
  .t-hint { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }

  .meter { margin-bottom: 11px; }
  .bar { position: relative; height: 38px; border-radius: var(--radius-round); background: rgba(28,22,17,0.07);
    border: 1px solid rgba(28,22,17,0.14); overflow: hidden; display: flex; align-items: center; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(45,122,58,0.32); transition: width 0.4s cubic-bezier(0.3,0,0.2,1), background 0.3s; }
  .fill.hot { background: rgba(196,68,68,0.34); }
  .cap { position: absolute; right: 10px; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }

  .read { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-top: 8px; }
  .r { display: flex; flex-direction: column; gap: 1px; }
  .r b { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 600; color: var(--text-primary); line-height: 1.1; }
  .r.hi b { color: var(--accent); }
  .r span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; color: rgba(28,22,17,0.55); }

  .verdict { border-left: 3px solid #2d7a3a; background: rgba(45,122,58,0.08); border-radius: 0 var(--radius-round) var(--radius-round) 0;
    padding: 10px 14px; transition: border-color 0.25s, background 0.25s; }
  .verdict.hot { border-left-color: #c44; background: rgba(196,68,68,0.07); }
  .verdict p { margin: 0; font-size: 13.5px; line-height: 1.58; color: rgba(28,22,17,0.78); max-width: 88ch; }
  .verdict b { color: var(--text-primary); }

  .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-top: 12px; }
  .tier { border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-round); background: rgba(255,255,255,0.5); padding: 10px 13px; }
  .ti-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .ti-h b { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .ti-h em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent); white-space: nowrap; }
  .ti-what { margin: 6px 0 5px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); }
  .ti-why { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.55); padding-top: 5px; border-top: 1px solid rgba(28,22,17,0.08); }

  .mb-foot { margin: 11px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .mb-foot b { color: rgba(28,22,17,0.82); }
</style>
