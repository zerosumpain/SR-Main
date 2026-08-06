<script lang="ts">
  // ManifestBudget — the single switch that makes the argument: show the model everything,
  // or show it a curated twenty plus one door to the rest. The bar is to scale against the
  // full catalogue, so flipping it moves the fill by three quarters of the track.
  //
  // The tier cards and the explanatory paragraphs that used to live in here are gone: the
  // tiers are a chart on the page now, and the switch does not need prose to be understood.
  import { MANIFEST } from '../../../lib/tools';

  let showAll = $state(false);

  // Everything in a median prompt that is not a tool description. The served manifest is
  // already inside the measured median, so swapping manifests moves the total, not the rest.
  const REST = MANIFEST.medianPrompt - MANIFEST.servedTokens;

  const tokens = $derived(showAll ? MANIFEST.fullTokens : MANIFEST.servedTokens);
  const bytes = $derived(showAll ? MANIFEST.fullBytes : MANIFEST.servedBytes);
  const visible = $derived(showAll ? MANIFEST.registered : MANIFEST.shown);
  const pct = $derived((tokens / MANIFEST.fullTokens) * 100);
  // Share of the prompt this manifest would produce — not of the median, which already
  // contains the served manifest and would flatter the full-catalogue case.
  const promptPct = $derived((tokens / (REST + tokens)) * 100);
</script>

<div class="mb">
  <div class="mb-head">
    <span class="k">Prefilled every turn, before you type a word</span>
    <button class="tog" class:on={showAll} aria-pressed={showAll} onclick={() => (showAll = !showAll)}>
      <span class="t-state">{showAll ? 'Showing all 155' : 'Showing 21'}</span>
      <span class="t-sw" aria-hidden="true"><i></i></span>
      <span class="t-hint">{showAll ? 'click to curate' : 'click to show everything'}</span>
    </button>
  </div>

  <div class="bar" role="img"
       aria-label="Tool manifest cost: {tokens.toLocaleString()} tokens from {visible} definitions, against a full catalogue of {MANIFEST.fullTokens.toLocaleString()} tokens from {MANIFEST.registered}.">
    <span class="fill" class:hot={showAll} style="width:{pct}%"></span>
    <span class="cap">full catalogue — {MANIFEST.fullTokens.toLocaleString()} tokens</span>
  </div>

  <div class="read">
    <div class="r"><b>{visible}</b><span>definitions the model sees</span></div>
    <div class="r"><b>≈{tokens.toLocaleString()}</b><span>tokens of prefill</span></div>
    <div class="r"><b>{bytes.toLocaleString()}</b><span>bytes serialised</span></div>
    <div class="r hi"><b>{promptPct.toFixed(0)}%</b><span>of the whole prompt</span></div>
  </div>

  <p class="verdict" class:hot={showAll} aria-live="polite">
    {#if showAll}
      <b>The tool list now rivals everything else combined</b> — instructions, retrieved context, conversation. The model reads all of it before emitting a character.
    {:else}
      <b>{MANIFEST.savedTokens.toLocaleString()} tokens saved every turn</b>, for the {MANIFEST.dispatcherTokens} the dispatcher costs. All {MANIFEST.registered} stay reachable.
    {/if}
  </p>
</div>

<style>
  .mb { display: flex; flex-direction: column; gap: 10px; }
  .mb-head { display: flex; gap: 12px 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--success); }

  .tog { display: flex; align-items: center; gap: 9px; cursor: pointer; font-family: inherit;
    padding: 5px 11px 5px 12px; border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-pill); background: rgba(255,255,255,0.6);
    transition: border-color 0.13s, background 0.13s; }
  .tog:hover { background: rgba(255,255,255,0.95); border-color: rgba(28,22,17,0.36); }
  .t-state { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; color: var(--text-primary); }
  .t-sw { flex-shrink: 0; display: block; width: 44px; height: 22px; border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--success) 34%, transparent);
    border: 1px solid rgba(28,22,17,0.2); position: relative; transition: background 0.18s; }
  .tog.on .t-sw { background: color-mix(in srgb, var(--error) 40%, transparent); }
  .t-sw i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: var(--radius-pill);
    background: #fff; transition: left 0.18s; }
  .tog.on .t-sw i { left: 24px; }
  .t-hint { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }

  .bar { position: relative; height: 40px; border-radius: var(--radius-round); background: rgba(28,22,17,0.07);
    border: 1px solid rgba(28,22,17,0.14); overflow: hidden; display: flex; align-items: center; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--success) 36%, transparent);
    transition: width 0.45s cubic-bezier(0.3,0,0.2,1), background 0.3s; }
  .fill.hot { background: color-mix(in srgb, var(--error) 38%, transparent); }
  .cap { position: absolute; right: 10px; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.5); }

  .read { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .r { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .r b { font-family: 'JetBrains Mono', monospace; font-size: 17px; font-weight: 600;
    color: var(--text-primary); line-height: 1.1; }
  .r.hi b { color: var(--accent); }
  .r span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em;
    color: rgba(28,22,17,0.55); line-height: 1.35; }

  .verdict { margin: 0; padding: 9px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent);
    font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.78); max-width: 88ch;
    transition: border-color 0.25s, background 0.25s; }
  .verdict.hot { border-left-color: var(--error); background: color-mix(in srgb, var(--error) 8%, transparent); }
  .verdict b { color: var(--text-primary); }

  @media (max-width: 460px) { .t-hint { display: none; } }
</style>
