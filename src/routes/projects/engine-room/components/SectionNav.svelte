<script lang="ts">
  // SectionNav — two levels: the four parts, then the pages inside the current part.
  //
  // The first version was a single row of ten equal tabs, which told a reader nothing about
  // how the study was organised and left every page feeling like a peer of every other. The
  // hierarchy is now visible in the chrome: you always know which part you are in, and the
  // second row only shows the pages that belong to it.
  import { app } from '../lib/appState.svelte';
  import { page } from '$app/stores';
  import { B, PARTS, href, partById } from '../lib/nav';

  const pathname = $derived($page.url.pathname.replace(/\/$/, ''));
  const atIndex = $derived(pathname === B);

  const currentPart = $derived(PARTS.find((p) => pathname.startsWith(`${B}/${p.id}`))?.id ?? null);
  const part = $derived(currentPart ? partById(currentPart) : null);
  const currentLeaf = $derived(
    part ? part.leaves.find((l) => pathname === href(part.id, l.slug)) ?? null : null,
  );

  const TRACE = href('turn', 'trace');
  const onTrace = $derived(pathname === TRACE);

  const label = $derived(
    atIndex ? 'The Engine Room' : currentLeaf ? currentLeaf.label : part ? part.name : 'Sections',
  );

  let menuOpen = $state(false);
</script>

<div class="secnav" style={part ? `--tone:${part.tone}` : ''}>
  <div class="row-one">
    <nav class="parts" aria-label="Parts">
      <a class="tab home" class:active={atIndex} href={B} title="The whole machine on one page">◆</a>
      {#each PARTS as p}
        <a class="tab" class:active={currentPart === p.id} href={href(p.id)}
           style="--pt:{p.tone}" title={p.strap}>
          <span class="t-no">{p.no}</span>{p.name}
        </a>
      {/each}
      <a class="tab tracelink" class:active={onTrace} href={TRACE}
         title="Follow one message through every stage and every layer">◧ Trace a turn</a>
    </nav>

    <button class="burger" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Study menu">
      <span class="bg-icon" aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
      <span class="bg-cur">{label}</span>
      <span class="bg-chev" class:open={menuOpen} aria-hidden="true">▾</span>
    </button>

    <div class="detail" role="group" aria-label="Explanation detail">
      <span class="d-lab">Explain it as</span>
      <div class="seg">
        <button class:on={app.narrative === 'eli5'} onclick={() => (app.narrative = 'eli5')}
                title="Plain English — the default. What it does, why it exists, no jargon.">Plain English</button>
        <button class:on={app.narrative === 'research'} onclick={() => (app.narrative = 'research')}
                title="Engineering view — the full explanation, with the mechanism.">Engineering</button>
      </div>
    </div>
  </div>

  {#if part}
    <nav class="leaves" aria-label="Pages in {part.name}">
      <span class="lv-lab">{part.no} · {part.name}</span>
      {#each part.leaves as l}
        <a class="lv" class:active={currentLeaf?.slug === l.slug} href={href(part.id, l.slug)}>{l.label}</a>
      {/each}
    </nav>
  {/if}

  {#if menuOpen}
    <button class="nav-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <nav class="nav-menu" aria-label="All pages">
      <a class="nm-top" class:active={atIndex} href={B} onclick={() => (menuOpen = false)}>The Engine Room</a>
      {#each PARTS as p}
        <span class="nm-part" style="--pt:{p.tone}">Part {p.no} · {p.name}</span>
        <a class="nm-hub" class:active={currentPart === p.id && !currentLeaf} href={href(p.id)}
           onclick={() => (menuOpen = false)}>{p.strap}</a>
        {#each p.leaves as l}
          <a class="nm-item" class:active={currentLeaf?.slug === l.slug && currentPart === p.id}
             href={href(p.id, l.slug)} onclick={() => (menuOpen = false)}>{l.label}</a>
        {/each}
      {/each}
    </nav>
  {/if}
</div>

<style>
  .secnav { --tone: var(--accent-ink); position: sticky; top: var(--topH, 0px); z-index: 12;
    background: rgba(241,234,214,0.96); backdrop-filter: blur(6px); border-bottom: 1px solid rgba(28,22,17,0.1); }
  .row-one { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px;
    flex-wrap: wrap; padding: 8px 32px; }
  .parts { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .tab { --pt: var(--accent-ink); display: inline-flex; align-items: baseline; gap: 6px;
    font-family: var(--font-body); font-size: var(--fs-label); font-weight: 500; color: var(--ink, var(--text-primary));
    text-decoration: none; padding: 6px 13px; border-radius: var(--radius-sharp);
    border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.55);
    transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .tab:hover { background: rgba(28,22,17,0.08); border-color: rgba(28,22,17,0.4); }
  .tab.active { background: var(--pt); color: #fff; border-color: var(--pt); }
  .t-no { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; opacity: 0.6; }
  .tab.home { padding: 6px 11px; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); }
  .tab.home.active { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

  .tab.tracelink { background: var(--accent-ink); color: #fff; border-color: var(--accent-ink);
    font-weight: 600; margin-left: 6px; }
  .tab.tracelink:hover { background: #0b4a53; border-color: #0b4a53; color: #fff; }
  .tab.tracelink.active { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }

  .leaves { display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    padding: 6px 32px 7px; border-top: 1px solid rgba(28,22,17,0.08);
    background: color-mix(in srgb, var(--tone) 5%, transparent); }
  .lv-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--tone); margin-right: 4px; }
  .lv { font-family: var(--font-body); font-size: var(--fs-label); color: rgba(28,22,17,0.72);
    text-decoration: none; padding: 4px 11px; border-radius: var(--radius-pill);
    border: 1px solid transparent; transition: background 0.12s, color 0.12s; }
  .lv:hover { background: rgba(255,255,255,0.7); color: var(--text-primary); }
  .lv.active { background: var(--tone); color: #fff; font-weight: 500; }

  .detail { display: inline-flex; align-items: center; gap: 7px; }
  .d-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
    letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .seg { display: inline-flex; background: rgba(28,22,17,0.07); padding: 2px;
    border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; color: var(--text-primary); padding: 5px 11px;
    border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs);
    cursor: pointer; white-space: nowrap; }
  .seg button.on { background: var(--accent-ink); color: #fff; }

  .burger { display: none; align-items: center; gap: 8px; font-family: var(--font-body);
    font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); background: rgba(255,255,255,0.65);
    border: 1px solid rgba(28,22,17,0.28); border-radius: var(--radius-sharp); padding: 7px 13px; cursor: pointer; }
  .burger .bg-icon { font-size: var(--fs-nav); line-height: 1; }
  .burger .bg-cur { max-width: 44vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .burger .bg-chev { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); transition: transform 0.15s; }
  .burger .bg-chev.open { transform: rotate(180deg); }

  .nav-scrim { position: fixed; inset: 0; z-index: 18; background: rgba(28,22,17,0.18); border: none; cursor: pointer; }
  .nav-menu { position: absolute; top: 100%; left: 0; right: 0; z-index: 19; display: flex; flex-direction: column; gap: 1px;
    background: var(--bg); border-bottom: 1px solid rgba(28,22,17,0.18);
    padding: 8px 16px 14px; max-height: 74vh; overflow-y: auto; }
  .nm-top { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--text-primary);
    text-decoration: none; padding: 8px 12px; border-radius: var(--radius-sharp); }
  .nm-part { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--pt); margin: 11px 0 2px; padding: 0 12px; }
  .nm-hub { font-family: var(--font-body); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6);
    text-decoration: none; padding: 4px 12px 6px; }
  .nm-item { font-family: var(--font-body); font-size: var(--fs-nav); font-weight: 500; color: var(--text-primary);
    text-decoration: none; padding: 8px 12px 8px 20px; border-radius: var(--radius-sharp); }
  .nm-item:hover, .nm-hub:hover, .nm-top:hover { background: rgba(28,22,17,0.06); }
  .nm-item.active, .nm-top.active, .nm-hub.active { background: var(--text-primary); color: var(--bg); }

  @media (max-width: 1180px) {
    .parts { display: none; }
    .burger { display: inline-flex; }
    .row-one { padding: 7px 14px; gap: 8px 12px; }
    .leaves { padding: 6px 14px 7px; }
  }
</style>
