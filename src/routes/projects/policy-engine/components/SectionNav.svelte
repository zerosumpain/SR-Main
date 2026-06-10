<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';

  // Overview + the Briefing anchor the walk-through; the Field Studies each pull one
  // thread; Method is the (non-linear) reference, set apart on the right.
  const BRIEFING = [
    { href: '/projects/policy-engine', label: 'Overview' },
    { href: '/projects/policy-engine/outcomes', label: 'The Briefing' },
  ];
  const STUDIES = [
    { href: '/projects/policy-engine/population', label: 'Population' },
    { href: '/projects/policy-engine/regions', label: 'Regions' },
    { href: '/projects/policy-engine/global', label: 'Global' },
    { href: '/projects/policy-engine/monitor', label: 'Monitoring' },
    { href: '/projects/policy-engine/jigsaw', label: 'Jigsaw' },
    { href: '/projects/policy-engine/neet', label: 'NEET' },
    { href: '/projects/policy-engine/send', label: 'SEND' },
  ];
  const MEMO = { href: '/projects/policy-engine/memo', label: 'The Memo' };
  const METHOD = { href: '/projects/policy-engine/method', label: 'How it works' };
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');
</script>

<div class="secnav">
  <nav class="tabs" aria-label="Sections">
    {#each BRIEFING as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <span class="grp-lab" aria-hidden="true">Field studies</span>
    {#each STUDIES as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <a class="tab memo" class:active={active(MEMO.href)} href={MEMO.href} title="The synthesis — what the field studies add up to, in one place">✎ {MEMO.label}</a>
    <a class="tab method" class:active={active(METHOD.href)} href={METHOD.href} title="The explainer — how the engine works (not part of the walk-through)">⚙ {METHOD.label}</a>
  </nav>
  <div class="detail" role="group" aria-label="Explanation detail">
    <span class="d-lab">Explain it as</span>
    <div class="seg">
      <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
              title="Research view — the full explanation with the evidence and the model mechanism.">Research</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
              title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
    </div>
  </div>
</div>

<style>
  .secnav { position: sticky; top: var(--topH, 0px); z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap;
    padding: 8px 32px; background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tab { font-family: 'DM Sans', system-ui, sans-serif; font-size: 13.5px; font-weight: 500; color: var(--ink, #1c1611); text-decoration: none;
    padding: 7px 15px; border-radius: 9px; border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55); transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-color: var(--ink, #1c1611); }
  .nav-sep { width: 1px; height: 22px; background: rgba(28,22,17,0.2); margin: 0 6px; }
  .grp-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase;
    color: rgba(28,22,17,0.42); margin-right: 2px; }
  @media (max-width: 620px) { .grp-lab { display: none; } }
  .tab.method { border-style: dashed; background: transparent; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .tab.method:hover { background: rgba(28,22,17,0.05); color: var(--ink, #1c1611); }
  .tab.method.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-style: solid; }
  .tab.memo { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: rgba(177,69,94,0.05); }
  .tab.memo:hover { background: rgba(177,69,94,0.12); border-color: #8a2d3a; }
  .tab.memo.active { background: #8a2d3a; color: var(--paper, #f1ead6); border-color: #8a2d3a; }
  @media (max-width: 620px) { .nav-sep { display: none; } }
  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 7px; border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink, #1c1611); padding: 5px 11px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .seg button.on { background: #3f7d6e; color: #fff; }
  @media (max-width: 760px) { .secnav { padding: 7px 14px; } }
</style>
