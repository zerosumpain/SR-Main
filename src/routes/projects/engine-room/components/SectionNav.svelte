<script lang="ts">
  // SectionNav — the ink bar every page sits under, and the chapter strip inside a part.
  //
  // Row one is the whole study at a glance: the brand, the three parts in their own colours,
  // the plain-English / engineering switch and Ask. Inside a part, row two lists its chapters
  // as numbered stops, so a reader always knows where they are and how far there is to go.
  // A hairline in the part's colour runs along the bottom as the page scrolls. Under about
  // a thousand pixels the parts fold into one drawer, which also carries the switch.
  import { page } from '$app/state';
  import { scroll } from '../lib/motion';
  import { app } from '../lib/appState.svelte';
  import { still } from '../lib/motion';
  import { B, PARTS, href, partById } from '../lib/nav';

  const pathname = $derived(page.url.pathname.replace(/\/$/, ''));
  const atIndex = $derived(pathname === B);
  const currentPart = $derived(PARTS.find((p) => pathname.startsWith(`${B}/${p.id}`))?.id ?? null);
  const part = $derived(currentPart ? partById(currentPart) : null);
  const currentLeaf = $derived(part ? part.leaves.find((l) => pathname === href(part.id, l.slug)) ?? null : null);
  const label = $derived(atIndex ? 'Overview' : currentLeaf ? currentLeaf.label : part ? part.name : 'Contents');

  let menuOpen = $state(false);
  $effect(() => { pathname; menuOpen = false; });

  function readingLine(el: HTMLElement) {
    if (still()) return;
    return scroll((p: number) => { el.style.transform = `scaleX(${p})`; });
  }
</script>

<div class="bar" data-surface="ink">
  <div class="row">
    <a class="er-brand" href={B} aria-label="The Engine Room, overview">
      <svg class="mark" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="6 3.4" />
        <circle cx="24" cy="24" r="6" fill="currentColor" />
      </svg>
      <span class="b-name">The Engine Room</span>
    </a>

    <nav class="parts" aria-label="Parts">
      {#each PARTS as p}
        <a class="part" class:on={currentPart === p.id} data-part={p.id} href={href(p.id)} title={p.strap}
           aria-current={currentPart === p.id && !currentLeaf ? 'page' : undefined}>
          <span class="p-no">{p.no}</span><span class="p-name">{p.name}</span>
        </a>
      {/each}
    </nav>

    <div class="tools">
      <div class="seg" role="group" aria-label="Explain it as">
        <button class:on={app.narrative === 'eli5'} aria-pressed={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
                title="Plain English: what it does and why, no jargon">Plain</button>
        <button class:on={app.narrative === 'research'} aria-pressed={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
                title="The engineering view: the same points, with the mechanism">Engineering</button>
      </div>
      <button class="ask" onclick={() => (app.askOpen = true)}><span aria-hidden="true">✦</span> Ask</button>
      <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-controls="er-drawer">
        <span class="bg-cur">{label}</span>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" class="bg-ico" class:open={menuOpen}>
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.8" />
        </svg>
      </button>
    </div>
  </div>

  {#if part}
    <nav class="chapters" data-part={part.id} aria-label="Chapters in {part.name}">
      <a class="ch hub" class:on={!currentLeaf} href={href(part.id)} aria-current={!currentLeaf ? 'page' : undefined}>
        <span class="c-no">{part.no}</span>{part.name}
      </a>
      {#each part.leaves as l, i}
        <a class="ch" class:on={currentLeaf?.slug === l.slug} href={href(part.id, l.slug)}
           aria-current={currentLeaf?.slug === l.slug ? 'page' : undefined}>
          <span class="c-no">{part.no}.{i + 1}</span>{l.label}
        </a>
      {/each}
    </nav>
  {/if}

  <span class="line" data-part={part?.id} aria-hidden="true" {@attach readingLine}></span>

  {#if menuOpen}
    <button class="scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="drawer" id="er-drawer" aria-label="All pages">
      <a class="d-top" class:on={atIndex} href={B}>Overview</a>
      {#each PARTS as p}
        <div class="d-part" data-part={p.id}>
          <a class="d-head" class:on={currentPart === p.id && !currentLeaf} href={href(p.id)}>
            <span class="d-no">Part {p.no}</span><b>{p.name}</b><span class="d-strap">{p.strap}</span>
          </a>
          {#each p.leaves as l, i}
            <a class="d-item" class:on={currentLeaf?.slug === l.slug && currentPart === p.id} href={href(p.id, l.slug)}>
              <span class="d-n">{p.no}.{i + 1}</span>{l.label}
            </a>
          {/each}
        </div>
      {/each}
      <div class="d-seg seg" role="group" aria-label="Explain it as">
        <button class:on={app.narrative === 'eli5'} aria-pressed={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}>Plain English</button>
        <button class:on={app.narrative === 'research'} aria-pressed={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}>Engineering</button>
      </div>
    </nav>
  {/if}
</div>

<style>
  .bar { position: relative; background: var(--er-ink); border-bottom: 1px solid var(--rule); }
  .row { display: flex; align-items: center; gap: 12px 22px; padding: 10px var(--er-gutter); max-width: calc(var(--er-measure) + 2 * var(--er-gutter)); margin: 0 auto; box-sizing: border-box; }

  .er-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--fg); flex-shrink: 0; }
  .mark { width: 26px; height: 26px; color: var(--er-orange-ink); animation: turn 18s linear infinite; }
  @keyframes turn { to { transform: rotate(360deg); } }
  .b-name { font-family: var(--er-display); text-transform: uppercase; font-size: 17px; letter-spacing: 0.01em; white-space: nowrap; }

  .parts { display: flex; gap: 4px; margin-left: 8px; }
  .part { position: relative; display: inline-flex; align-items: baseline; gap: 7px; padding: 8px 14px 9px; text-decoration: none;
    color: var(--fg-2); font-family: var(--er-mono); font-size: var(--fs-label); letter-spacing: 0.06em; text-transform: uppercase;
    border-radius: var(--radius-sharp); transition: color 0.2s, background 0.2s; }
  .part::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: 3px; height: 2px; background: var(--tone-text);
    transform: scaleX(0); transform-origin: left; transition: transform 0.35s var(--er-ease); }
  .part:hover { color: var(--fg); background: var(--wash); }
  .part:hover::after, .part.on::after { transform: scaleX(1); }
  .part.on { color: var(--fg); }
  .p-no { color: var(--tone-text); font-size: var(--fs-label-xs); }

  .tools { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .seg { display: inline-flex; padding: 2px; border: 1px solid var(--rule); border-radius: var(--radius-pill); }
  .seg button { background: transparent; border: none; color: var(--fg-3); padding: 6px 12px; border-radius: var(--radius-pill);
    font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em; cursor: pointer; white-space: nowrap; transition: color 0.2s, background 0.2s; }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--er-cream); color: var(--er-ink); }
  .ask { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--fg); cursor: pointer;
    border: 1px solid var(--rule-strong); border-radius: var(--radius-pill); padding: 6px 14px;
    font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; transition: border-color 0.2s, background 0.2s; }
  .ask span { color: var(--er-orange-ink); }
  .ask:hover { border-color: var(--er-orange-ink); background: var(--wash); }

  .burger { display: none; align-items: center; gap: 10px; background: transparent; color: var(--fg); cursor: pointer;
    border: 1px solid var(--rule-strong); border-radius: var(--radius-sharp); padding: 7px 10px 7px 12px;
    font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; text-transform: uppercase; }
  .bg-cur { max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .chapters { display: flex; gap: 2px; align-items: stretch; overflow-x: auto; scrollbar-width: none;
    padding: 0 var(--er-gutter); max-width: calc(var(--er-measure) + 2 * var(--er-gutter)); margin: 0 auto; box-sizing: border-box; }
  .chapters::-webkit-scrollbar { display: none; }
  .ch { position: relative; display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap; text-decoration: none;
    padding: 9px 14px 11px; color: var(--fg-3); font-size: var(--fs-label); transition: color 0.2s; }
  .ch::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--rule); }
  .ch.on::before { background: var(--tone-text); }
  .ch:hover { color: var(--fg); }
  .ch.on { color: var(--fg); }
  .c-no { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); }
  .ch.hub { font-family: var(--er-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; }

  .line { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--tone-text); transform-origin: left;
    transform: scaleX(0); pointer-events: none; }
  .line:not([data-part]) { background: var(--er-orange-ink); }

  .scrim { position: fixed; inset: 0; z-index: 1; background: rgba(26, 16, 8, 0.5); border: none; cursor: pointer; }
  .drawer { position: absolute; z-index: 2; top: 100%; left: 0; right: 0; max-height: calc(100dvh - var(--topH, 0px) - 12px); overflow-y: auto;
    background: var(--er-ink); border-top: 1px solid var(--rule); padding: 12px var(--er-gutter) 22px; display: flex; flex-direction: column; gap: 6px; }
  .d-top { font-family: var(--er-display); text-transform: uppercase; font-size: 20px; color: var(--fg); text-decoration: none; padding: 8px 0; }
  .d-part { border-top: 1px solid var(--rule); padding: 10px 0 4px; display: flex; flex-direction: column; }
  .d-head { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; text-decoration: none; color: var(--fg); padding: 4px 0 8px; }
  .d-no { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--tone-text); letter-spacing: 0.1em; text-transform: uppercase; align-self: center; }
  .d-head b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: 22px; }
  .d-strap { grid-column: 1 / -1; font-size: var(--fs-label); color: var(--fg-3); }
  .d-item { display: flex; gap: 12px; align-items: baseline; text-decoration: none; color: var(--fg-2); font-size: var(--fs-nav); padding: 9px 0 9px 4px; border-left: 2px solid transparent; }
  .d-item.on, .d-head.on, .d-top.on { color: var(--tone-text); }
  .d-item.on { border-left-color: var(--tone-text); padding-left: 10px; }
  .d-n { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); min-width: 3.5ch; }
  .d-seg { align-self: flex-start; margin-top: 12px; }

  @media (max-width: 1020px) {
    .parts, .tools > .seg { display: none; }
    .burger { display: inline-flex; }
    .b-name { font-size: 15px; }
  }
  @media (max-width: 480px) {
    .ask { padding: 6px 10px; }
    .b-name { display: none; }
  }
</style>
