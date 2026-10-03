<script lang="ts">
  // Layout chrome for The Engine Room: the design tokens, the ink top bar, the footer and the
  // Ask dock. Every page below composes full-bleed bands (components/kit/Band.svelte) on top
  // of the tokens declared here.
  //
  // The palette is /health's, re-weighted for a show piece. Measurement sits on ink and
  // argument on paper, the rhythm /health set ("measurement is dark, argument is light").
  // Each of the three parts owns one warm tone from the same family: amber for Daydream,
  // burnt orange for Build and bronze for the App. Petrol, the site's counter-accent, is
  // kept for one meaning only, where I come in. Every tone has a paper-safe and an ink-safe
  // shade, so text in a part's colour clears AA on both grounds. The ratios are in the
  // comments beside each token.
  //
  // The Ask dock answers from this study's own corpus, which lib/retrieval.server.ts builds
  // from the same facts and copy the pages render.
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { app } from './lib/appState.svelte';
  import { REFERENCES } from './lib/references';
  import { B, PARTS } from './lib/nav';
  import SectionNav from './components/SectionNav.svelte';
  import AskModel from './components/AskModel.svelte';
  import FieldStudyNav from '$lib/components/FieldStudyNav.svelte';

  let { children } = $props();
  let topH = $state(0);

  const part = $derived(PARTS.find((p) => page.url.pathname.startsWith(`${B}/${p.id}`))?.id ?? null);

  // Key is versioned: v1 auto-saved the old 'research' default for everyone who ever
  // visited, so honouring it would silently keep the old default for returning readers.
  onMount(() => {
    try {
      const n = localStorage.getItem('er-narrative-2');
      if (n === 'research' || n === 'eli5') app.narrative = n;
    } catch { /* ignore */ }
    app.mounted = true;
  });
  $effect(() => { if (app.mounted) { try { localStorage.setItem('er-narrative-2', app.narrative); } catch { /* ignore */ } } });

  function onkey(e: KeyboardEvent) { if (e.key === 'Escape' && app.askOpen) app.askOpen = false; }
</script>

<svelte:window onkeydown={onkey} />

<div class="er" data-part={part ?? undefined} data-surface="paper" style="--topH:{topH}px">
  <div class="topstack" bind:clientHeight={topH}>
    <div class="fsn-row"><FieldStudyNav /></div>
    <SectionNav />
  </div>

  <main class="content">
    {@render children()}
  </main>

  <footer class="foot" data-surface="ink">
    <div class="foot-in">
      <div class="foot-brand">
        <svg class="foot-mark" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="6 3.4" />
          <circle cx="24" cy="24" r="6" fill="currentColor" />
        </svg>
        <p class="foot-title">The Engine Room</p>
        <p class="foot-sub">How three parts of strangeramblings.com work, explained by the code that runs them.</p>
      </div>
      <div class="foot-col">
        <h2 class="foot-h">A personal project</h2>
        <p>This is one person’s site, built in personal time. It’s described here because the engineering is worth
          showing, not because it’s a product. There’s nothing to buy and nothing to sign up for.</p>
      </div>
      <div class="foot-col">
        <h2 class="foot-h">Deliberately incomplete</h2>
        <p>Credentials, keys, personal data, addresses and anything else unsafe to publish are left out by design. Live
          figures are totals only. Names, limits and schedules are read from the running code at each deploy, counts from
          the database every few minutes, and the app’s make-up from its own source.</p>
      </div>
    </div>
    <div class="foot-in foot-base">
      <details class="sources-foot"><summary>Technologies and specifications referenced ({REFERENCES.length})</summary>
        <ul>{#each REFERENCES as r}<li><a href={r.url} target="_blank" rel="noopener">{r.name} ↗</a> {r.what}</li>{/each}</ul>
      </details>
      <p class="foot-disc"><code>/projects/engine-room</code> · Companion studies:
        <a href="/projects/policy-engine">The Policy Engine</a> · <a href="/projects/dfe-data-strategy">Keystone</a> ·
        Built with Claude Code.</p>
    </div>
  </footer>

  {#if !app.askOpen}
    <button class="ask-fab" onclick={() => (app.askOpen = true)} title="Ask questions about how this system works">
      <span class="fab-mark" aria-hidden="true">✦</span> Ask the system
    </button>
  {/if}
  {#if app.askOpen}
    <button class="ask-scrim" aria-label="Close" onclick={() => (app.askOpen = false)}></button>
    <div class="ask-dock" role="dialog" aria-modal="true" aria-label="Ask the system">
      <header class="ask-dock-head" data-surface="ink">
        <span class="adh-title">Ask the system</span>
        <span class="adh-sub">answers from this study only</span>
        <button class="adh-close" onclick={() => (app.askOpen = false)} aria-label="Close">✕</button>
      </header>
      <div class="ask-dock-body"><AskModel /></div>
    </div>
  {/if}
</div>

<style>
  :global(body) { margin: 0; }

  /* ───────────────────────── tokens ───────────────────────── */
  .er {
    /* grounds */
    --er-ink: #1a1008;              /* espresso: every measurement band */
    --er-ink-2: #2a1c10;            /* a panel lifted off the ink */
    --er-paper: #ede4d4;            /* the site's cream */
    --er-paper-hi: #f3ebdd;         /* a card on paper */
    --er-paper-deep: #e3d8c4;       /* a recessed paper band */
    --er-cream: #ede4d4;
    /* the warm family — fill / paper text / ink text */
    --er-amber: #d39a2c;  --er-amber-paper: #7a5a12;  --er-amber-ink: #e9b955;   /* 5.05:1 · 10.3:1 */
    --er-orange: #c4570a; --er-orange-paper: #a84808; --er-orange-ink: #e8863a;  /* 4.63:1 · 7.05:1 */
    --er-bronze: #96613a; --er-bronze-paper: #7a4820; --er-bronze-ink: #d4936a;  /* 6.00:1 · 7.29:1 */
    --er-brown: #3d2e1a;
    /* petrol means one thing here: where I come in */
    --er-petrol: #0e5b66; --er-petrol-ink: #7fb8c0;                              /* 6.15:1 · 8.49:1 */
    --er-fail: #b3261e; --er-fail-ink: #f08a7e;
    /* type */
    --er-display: 'Archivo Black', Impact, sans-serif;
    --er-serif: 'Fraunces', Georgia, serif;
    --er-body: 'DM Sans', system-ui, sans-serif;
    --er-mono: 'JetBrains Mono', ui-monospace, monospace;
    --er-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --er-measure: 1400px;
    --er-gutter: clamp(16px, 3vw, 44px);

    /* the default part tone is Build's orange; a part page overrides it below */
    --tone: var(--er-orange); --tone-paper: var(--er-orange-paper); --tone-ink: var(--er-orange-ink);

    position: relative; min-height: 100vh; background: var(--er-paper);
    color: var(--fg); font-family: var(--er-body); overflow-x: clip;
  }

  .er :global([data-part='daydream']), .er[data-part='daydream'] { --tone: var(--er-amber); --tone-paper: var(--er-amber-paper); --tone-ink: var(--er-amber-ink); }
  .er :global([data-part='build']), .er[data-part='build'] { --tone: var(--er-orange); --tone-paper: var(--er-orange-paper); --tone-ink: var(--er-orange-ink); }
  .er :global([data-part='app']), .er[data-part='app'] { --tone: var(--er-bronze); --tone-paper: var(--er-bronze-paper); --tone-ink: var(--er-bronze-ink); }

  /* Surfaces set the foreground ramp. Components read only these, so the same component
     works on ink or paper without a prop. */
  .er[data-surface='paper'], .er :global([data-surface='paper']) {
    --fg: #1a1008; --fg-2: rgba(26, 16, 8, 0.78); --fg-3: rgba(26, 16, 8, 0.6);
    --rule: rgba(26, 16, 8, 0.14); --rule-strong: rgba(26, 16, 8, 0.32); --wash: rgba(26, 16, 8, 0.04);
    --ground: var(--er-paper); --lift: var(--er-paper-hi);
    --tone-text: var(--tone-paper); --you: var(--er-petrol); --fail: var(--er-fail);
  }
  .er :global([data-surface='ink']) {
    --fg: #ede4d4; --fg-2: rgba(237, 228, 212, 0.8); --fg-3: rgba(237, 228, 212, 0.6);
    --rule: rgba(237, 228, 212, 0.16); --rule-strong: rgba(237, 228, 212, 0.4); --wash: rgba(237, 228, 212, 0.05);
    --ground: var(--er-ink); --lift: var(--er-ink-2);
    --tone-text: var(--tone-ink); --you: var(--er-petrol-ink); --fail: var(--er-fail-ink);
    color: var(--fg);
  }
  /* A part set INSIDE a surface has to re-resolve the surface's text shade. */
  .er :global([data-surface='paper'] [data-part]), .er :global([data-surface='paper'][data-part]) { --tone-text: var(--tone-paper); }
  .er :global([data-surface='ink'] [data-part]), .er :global([data-surface='ink'][data-part]) { --tone-text: var(--tone-ink); }

  /* ───────────────────────── motion contract ─────────────────────────
     Lines drawn on view: give a path pathLength="1" and data-draw; an ancestor with the
     `shown` attachment arms and then reveals it. --d staggers. Without script, or with
     reduced motion, nothing is armed and every line is simply there. */
  .er :global([data-armed] [data-draw]) { stroke-dasharray: 1; stroke-dashoffset: 1;
    transition: stroke-dashoffset 1.5s var(--er-ease) var(--d, 0s); }
  .er :global([data-armed][data-shown] [data-draw]) { stroke-dashoffset: 0; }
  .er :global([data-armed] [data-pop]) { opacity: 0; transform: scale(0.6); transform-box: fill-box; transform-origin: center;
    transition: opacity 0.5s var(--er-ease) var(--d, 0s), transform 0.7s var(--er-ease) var(--d, 0s); }
  .er :global([data-armed][data-shown] [data-pop]) { opacity: 1; transform: none; }
  .er :global([data-paused]), .er :global([data-paused] *) { animation-play-state: paused !important; }
  @media (prefers-reduced-motion: reduce) {
    .er :global(*), .er :global(*::before), .er :global(*::after) { animation: none !important; }
  }

  /* ───────────────────────── shared type ───────────────────────── */
  .er :global(.er-kicker) { display: block; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--tone-text); margin: 0 0 12px; }
  .er :global(.er-display) { font-family: var(--er-display); font-weight: 400; text-transform: uppercase;
    line-height: 0.92; letter-spacing: -0.015em; color: var(--fg); margin: 0; }
  .er :global(.er-display .hl) { color: var(--tone-text); }
  .er :global(.er-lede) { font-size: clamp(17px, 1.5vw, 20px); line-height: 1.55; color: var(--fg-2); margin: 0; }
  .er :global(.er-prose) { font-size: var(--fs-body); line-height: 1.65; color: var(--fg-2); }
  .er :global(.er-prose p) { margin: 0 0 14px; }
  .er :global(.er-prose b) { color: var(--fg); }
  .er :global(.er-prose code), .er :global(.er-code) { font-family: var(--er-mono); font-size: max(0.86em, var(--fs-label-xs));
    background: var(--wash); border: 1px solid var(--rule); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--fg); }
  .er :global(.er-pull) { font-family: var(--er-serif); font-style: italic; font-weight: 400; font-size: clamp(20px, 2.1vw, 28px);
    line-height: 1.35; color: var(--fg); margin: 0; }
  .er :global(a) { color: inherit; }
  .er :global(:focus-visible) { outline: 2px solid var(--you); outline-offset: 2px; }

  /* Kept for any page still on the old helpers. */
  .er :global(.pe-route) { padding: 26px var(--er-gutter) 8px; max-width: 1180px; margin: 0 auto; }
  .er :global(.pe-prose) { font-size: var(--fs-body-sm); line-height: 1.62; color: var(--fg-2); }

  /* ───────────────────────── chrome ───────────────────────── */
  .topstack { position: sticky; top: 0; z-index: 30; }
  .fsn-row { background: var(--er-paper); border-bottom: 1px solid rgba(26, 16, 8, 0.1); }
  .content { position: relative; z-index: 1; min-width: 0; }

  .foot { background: var(--er-ink); padding: clamp(40px, 5vw, 72px) var(--er-gutter) 28px; margin-top: 0; }
  .foot-in { max-width: var(--er-measure); margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 28px 44px; }
  .foot-mark { width: 40px; height: 40px; color: var(--er-orange-ink); }
  .foot-title { font-family: var(--er-display); text-transform: uppercase; font-size: 26px; line-height: 1; margin: 10px 0 8px; color: var(--fg); }
  .foot-sub { margin: 0; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--fg-3); max-width: 38ch; }
  .foot-h { font-family: var(--er-mono); font-weight: 500; font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--er-orange-ink); margin: 6px 0 10px; }
  .foot-col p { margin: 0; font-size: var(--fs-label); line-height: 1.6; color: var(--fg-2); }
  .foot-base { grid-template-columns: minmax(0, 1fr); margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--rule); gap: 10px; }
  .foot code { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-2); }
  .foot a { color: var(--er-petrol-ink); }
  .foot-disc { margin: 0; font-size: var(--fs-label-xs); color: var(--fg-3); }
  .sources-foot summary { cursor: pointer; font-family: var(--er-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--fg-3); padding: 4px 0; }
  .sources-foot ul { margin: 10px 0 4px; padding-left: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 6px 22px; list-style: square; }
  .sources-foot li { font-size: var(--fs-label-xs); line-height: 1.45; color: var(--fg-3); }
  .sources-foot a { text-decoration: none; border-bottom: 1px dashed currentColor; }
  @media (max-width: 900px) { .foot-in { grid-template-columns: minmax(0, 1fr); } }

  /* ───────────────────────── Ask ───────────────────────── */
  .ask-fab { position: fixed; z-index: 60; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 8px;
    font-family: var(--er-mono); font-size: var(--fs-label); font-weight: 500; letter-spacing: 0.04em; color: var(--er-cream);
    background: var(--er-ink); border: 1px solid rgba(237, 228, 212, 0.25); border-radius: var(--radius-pill);
    padding: 12px 18px; cursor: pointer; transition: background 0.2s, border-color 0.2s; }
  .ask-fab:hover { background: #2a1c10; border-color: var(--er-orange-ink); }
  .fab-mark { color: var(--er-orange-ink); }
  @media (min-width: 1021px) { .ask-fab { display: none; } }
  .ask-scrim { position: fixed; inset: 0; z-index: 70; background: rgba(26, 16, 8, 0.45); border: none; cursor: pointer; }
  .ask-dock { position: fixed; z-index: 71; top: 0; right: 0; height: 100vh; height: 100dvh; width: min(480px, 100vw);
    background: var(--er-paper); border-left: 1px solid rgba(26, 16, 8, 0.25); display: flex; flex-direction: column; }
  .ask-dock-head { display: flex; align-items: baseline; gap: 10px; padding: 16px 18px 14px; background: var(--er-ink); }
  .adh-title { font-family: var(--er-display); text-transform: uppercase; font-size: 18px; color: var(--fg); }
  .adh-sub { font-family: var(--er-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--fg-3); }
  .adh-close { margin-left: auto; background: none; border: none; font-size: var(--fs-body-sm); color: var(--fg-3); cursor: pointer; }
  .adh-close:hover { color: var(--fg); }
  .ask-dock-body { flex: 1; min-height: 0; padding: 14px 18px 16px; display: flex; flex-direction: column; }
</style>
