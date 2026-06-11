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
    { href: '/projects/policy-engine/early-years', label: 'Early Years' },
    { href: '/projects/policy-engine/population', label: 'Population' },
    { href: '/projects/policy-engine/regions', label: 'Regions' },
    { href: '/projects/policy-engine/global', label: 'Global' },
    { href: '/projects/policy-engine/monitor', label: 'Monitoring' },
    { href: '/projects/policy-engine/jigsaw', label: 'Jigsaw' },
    { href: '/projects/policy-engine/neet', label: 'NEET' },
    { href: '/projects/policy-engine/send', label: 'SEND' },
    { href: '/projects/policy-engine/attendance', label: 'Attendance' },
  ];
  const THEMES = { href: '/projects/policy-engine/themes', label: 'Themes' };
  const MEMO = { href: '/projects/policy-engine/memo', label: 'The Memo' };
  const METHOD = { href: '/projects/policy-engine/method', label: 'How it works' };
  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const active = (href: string) => pathname === href.replace(/\/$/, '');

  // burger menu (mobile) — grouped link list + the current section's label for the trigger
  const MENU_GROUPS = [
    { label: '', items: BRIEFING },
    { label: 'Field studies', items: STUDIES },
    { label: 'Synthesis & reference', items: [THEMES, MEMO, METHOD] },
  ];
  const ALL = [...BRIEFING, ...STUDIES, THEMES, MEMO, METHOD];
  const current = $derived(ALL.find((n) => active(n.href))?.label ?? 'Sections');
  let menuOpen = $state(false);
</script>

<div class="secnav">
  <!-- desktop: the full tab bar -->
  <nav class="tabs" aria-label="Sections">
    {#each BRIEFING as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <span class="grp-lab" aria-hidden="true">Field studies</span>
    {#each STUDIES as n}<a class="tab" class:active={active(n.href)} href={n.href}>{n.label}</a>{/each}
    <span class="nav-sep" aria-hidden="true"></span>
    <a class="tab themes" class:active={active(THEMES.href)} href={THEMES.href} title="The second spine — what the studies say in common, by theme: the evidence, the contradictions and the confidence">◈ {THEMES.label}</a>
    <a class="tab memo" class:active={active(MEMO.href)} href={MEMO.href} title="The synthesis — what the field studies add up to, in one place">✎ {MEMO.label}</a>
    <a class="tab method" class:active={active(METHOD.href)} href={METHOD.href} title="The explainer — how the engine works (not part of the walk-through)">⚙ {METHOD.label}</a>
  </nav>

  <!-- mobile: a burger that shows the current section and opens the full list -->
  <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Sections menu">
    <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
    <span class="bg-cur">{current}</span>
    <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
  </button>

  <div class="detail" role="group" aria-label="Explanation detail">
    <span class="d-lab">Explain it as</span>
    <div class="seg">
      <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
              title="Research view — the full explanation with the evidence and the model mechanism.">Research</button>
      <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
              title="ELI5 — the same thing in plain, jargon-free English.">ELI5</button>
    </div>
  </div>

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="Sections">
      {#each MENU_GROUPS as g}
        {#if g.label}<span class="nm-grp">{g.label}</span>{/if}
        {#each g.items as n}
          <a class="nm-item" class:active={active(n.href)} href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
        {/each}
      {/each}
    </nav>
  {/if}
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
  .tab.method { border-style: dashed; background: transparent; color: var(--ink-soft, rgba(28,22,17,0.6)); }
  .tab.method:hover { background: rgba(28,22,17,0.05); color: var(--ink, #1c1611); }
  .tab.method.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); border-style: solid; }
  .tab.memo { border-width: 1.5px; border-color: rgba(138,45,58,0.6); color: #8a2d3a; background: rgba(177,69,94,0.05); }
  .tab.memo:hover { background: rgba(177,69,94,0.12); border-color: #8a2d3a; }
  .tab.memo.active { background: #8a2d3a; color: var(--paper, #f1ead6); border-color: #8a2d3a; }
  .tab.themes { border-width: 1.5px; border-color: rgba(63,125,110,0.6); color: #2f6155; background: rgba(63,125,110,0.06); }
  .tab.themes:hover { background: rgba(63,125,110,0.14); border-color: #2f6155; }
  .tab.themes.active { background: #2f6155; color: var(--paper, #f1ead6); border-color: #2f6155; }

  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px; border-radius: 7px; border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--ink, #1c1611); padding: 5px 11px; border-radius: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .seg button.on { background: #3f7d6e; color: #fff; }

  /* burger trigger — hidden on desktop, shown on small screens */
  .burger { display: none; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600;
    color: var(--ink, #1c1611); background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.28); border-radius: 9px; padding: 7px 13px; cursor: pointer; }
  .burger .bg-icon { font-size: 14px; line-height: 1; }
  .burger .bg-cur { max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .burger .bg-chev { font-size: 10px; color: rgba(28,22,17,0.5); transition: transform 0.15s; }
  .burger .bg-chev.open { transform: rotate(180deg); }

  .nav-scrim { position: fixed; inset: 0; z-index: 18; background: rgba(28,22,17,0.18); border: none; cursor: pointer; }
  .nav-menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 19; display: flex; flex-direction: column; gap: 2px;
    background: var(--paper, #f1ead6); border-bottom: 1px solid rgba(28,22,17,0.18); box-shadow: 0 14px 28px -16px rgba(0,0,0,0.4);
    padding: 8px 16px 12px; max-height: 72vh; overflow-y: auto; }
  .nm-grp { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.42); margin: 8px 0 2px; }
  .nm-grp:first-child { margin-top: 2px; }
  .nm-item { font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 500; color: var(--ink, #1c1611); text-decoration: none;
    padding: 9px 12px; border-radius: 8px; border: 1px solid transparent; }
  .nm-item:hover { background: rgba(28,22,17,0.06); }
  .nm-item.active { background: var(--ink, #1c1611); color: var(--paper, #f1ead6); }

  @media (max-width: 860px) {
    .tabs { display: none; }
    .burger { display: inline-flex; }
    .secnav { padding: 7px 14px; gap: 8px 12px; }
  }
</style>
