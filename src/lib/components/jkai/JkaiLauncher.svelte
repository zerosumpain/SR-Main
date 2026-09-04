<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { recordLauncherPick, getLauncherRecentScores } from './launcher-recents';

  let { open = false, onClose }: { open?: boolean; onClose: () => void } = $props();

  type NavItem = { code: string; label: string; desc: string; keywords: string; href?: string; run?: () => void | Promise<void> };

  // Quick actions — the palette DOES things, not just navigates.
  let actionStatus = $state<string | null>(null);
  let actionBusy = $state(false);

  async function runBriefing() {
    actionBusy = true;
    actionStatus = 'Generating briefing…';
    try {
      const res = await fetch('/api/admin/briefing/run', { method: 'POST' });
      actionStatus = res.ok ? 'Briefing generated ✓' : 'Briefing failed';
    } catch {
      actionStatus = 'Briefing failed';
    } finally {
      actionBusy = false;
    }
  }
  function navTo(href: string) {
    onClose();
    void goto(href);
  }

  const ACTIONS: NavItem[] = [
    { code: '✦', label: 'Run briefing now', desc: "Generate today's digest", keywords: 'briefing run digest generate', run: runBriefing },
    { code: '+', label: 'New chat', desc: 'Start a fresh conversation', keywords: 'new chat conversation', run: () => navTo('/jkai') },
    { code: '⊹', label: 'New monitor', desc: 'Watch something new', keywords: 'new monitor watch alert', run: () => navTo('/jkai/daydreams/watches') },
    { code: '⌕', label: 'Search knowledge', desc: 'Recall across everything', keywords: 'search knowledge recall find', run: () => navTo('/jkai/intel/search') },
  ];

  const NAV: { section: string; items: NavItem[] }[] = [
    {
      section: 'Create',
      items: [
        { code: 'CHT', label: 'Chat', href: '/jkai', desc: 'The orchestrator chat hub', keywords: 'home talk ask' },
        { code: 'CVS', label: 'Canvas', href: '/jkai/canvas', desc: 'Visual workflow builder', keywords: 'workflow nodes flow automation' },
        { code: 'BLD', label: 'Builds', href: '/jkai/builds', desc: 'Autonomous builder', keywords: 'build autonomous app' },
        { code: 'RES', label: 'Research', href: '/research', desc: 'Deep research desk', keywords: 'deep dive gather synthesize' },
        { code: 'NWS', label: 'News', href: '/news', desc: 'Hacker News and Lobsters reading desk', keywords: 'feed articles hacker news lobsters read' },
      ],
    },
    {
      section: 'Recall & agents',
      items: [
        { code: 'INT', label: 'Intel', href: '/jkai/intel', desc: 'Knowledge graph, notes & alerts', keywords: 'graph entities relationships' },
        { code: 'CG', label: 'Codegraph', href: '/jkai/codegraph', desc: 'What building this codebase has already taught us', keywords: 'code graph build history episodes lessons precedent relevance' },
        { code: 'KN', label: 'Recall', href: '/jkai/intel/search', desc: 'Search notes, entities, files, research, memory & datastore', keywords: 'recall search @knowledge unified knowledge' },
        { code: 'AG', label: 'Agent team', href: '/jkai/agents', desc: 'Specialists, prompts and shared memory', keywords: 'delegate specialist team persona prompt workbench system soul' },
      ],
    },
    {
      section: 'Proactive',
      items: [
        { code: 'DAY', label: 'Daydreams', href: '/jkai/daydreams/feed', desc: 'Briefings, watches and spare-cycle learning', keywords: 'daydream notice pattern idle location places suggestions monitor watch alert digest briefing improvement ledger' },
      ],
    },
    {
      section: 'Ops',
      items: [
        { code: 'DOC', label: 'Doctor', href: '/jkai/daydreams/doctor', desc: 'Why your workflows are failing', keywords: 'doctor failed workflow fix repair triage' },
      ],
    },
  ];

  const SECTION_COLOR: Record<string, number> = { Actions: 0, Create: 1, 'Recall & agents': 2, Proactive: 3, Ops: 0 };

  let query = $state('');
  let selected = $state(0);
  let status = $state<{ monitors?: { active: number }; briefing?: { latest: string | null } } | null>(null);

  // Recents — loaded once per open (plain snapshot; localStorage isn't reactive).
  let recentScores = $state<Record<string, number>>({});

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const match = (i: NavItem) => !q || `${i.label} ${i.desc} ${i.keywords}`.toLowerCase().includes(q);
    const out: { section: string; items: NavItem[] }[] = [];
    // Recent workspaces float to the top (only when not searching — a query
    // should rank purely by match).
    if (!q) {
      const all = NAV.flatMap((g) => g.items);
      const recent = all
        .filter((i) => i.href && (recentScores[i.href] ?? 0) > 0)
        .sort((a, b) => (recentScores[b.href!] ?? 0) - (recentScores[a.href!] ?? 0))
        .slice(0, 4)
        // Clones, not references — each rendered row needs its own identity so
        // keyboard selection (flat.indexOf) can't highlight the group twin too.
        .map((i) => ({ ...i }));
      if (recent.length >= 2) out.push({ section: 'Recent', items: recent });
    }
    const acts = ACTIONS.filter(match);
    if (acts.length) out.push({ section: 'Actions', items: acts });
    for (const grp of NAV) {
      const items = grp.items.filter(match);
      if (items.length) out.push({ section: grp.section, items });
    }
    return out;
  });

  // Flat list for keyboard nav (kept in render order).
  const flat = $derived(filtered.flatMap((g) => g.items));

  function badge(item: NavItem): string | null {
    if (item.code === 'MON' && status?.monitors) return status.monitors.active > 0 ? `${status.monitors.active} on` : null;
    if (item.code === 'BR' && status?.briefing?.latest) return status.briefing.latest;
    return null;
  }

  function go(item: NavItem) {
    // Actions run in place (feedback stays visible / they navigate themselves).
    if (item.run) { void item.run(); return; }
    recordLauncherPick(item.href!);
    onClose();
    query = '';
    void goto(item.href!);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(selected + 1, flat.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(selected - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[selected]) go(flat[selected]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  // Reset on open/close, and lazy-load live status once (first open). Tracks
  // ONLY the `open` prop; all state writes go through untrack so the effect
  // never depends on its own writes.
  let statusLoaded = false; // plain flag — not reactive
  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen) {
        selected = 0;
        recentScores = getLauncherRecentScores();
        if (!statusLoaded) {
          statusLoaded = true;
          fetch('/api/jkai/hub-status')
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => { if (s) status = s; })
            .catch(() => {});
        }
      } else {
        query = '';
      }
    });
  });
</script>

{#if open}
  <div class="jl-bg" role="button" tabindex="-1" onclick={onClose} onkeydown={() => {}}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="jl" role="dialog" aria-label="JKAI launcher" onclick={(e) => e.stopPropagation()}>
      <div class="jl-search">
        <span class="jl-slash">⌘K</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="jl-input"
          placeholder="Jump to a workspace…"
          bind:value={query}
          oninput={() => (selected = 0)}
          onkeydown={onKey}
          autofocus
        />
      </div>
      <div class="jl-body">
        {#each filtered as grp (grp.section)}
          <div class="jl-group">
            <div class="jl-group-hd">{grp.section}</div>
            {#each grp.items as item (grp.section + ':' + item.label)}
              {@const idx = flat.indexOf(item)}
              <button
                class="jl-item"
                class:sel={idx === selected}
                onclick={() => go(item)}
                onmouseenter={() => (selected = idx)}
              >
                <span class="jl-code jl-code-{SECTION_COLOR[grp.section] ?? 0}">{item.code}</span>
                <span class="jl-text">
                  <span class="jl-label">{item.label}{#if badge(item)}<span class="jl-badge">{badge(item)}</span>{/if}</span>
                  <span class="jl-desc">{item.desc}</span>
                </span>
              </button>
            {/each}
          </div>
        {/each}
        {#if flat.length === 0}
          <p class="jl-empty">No workspace matches “{query}”.</p>
        {/if}
      </div>
      {#if actionStatus}
        <div class="jl-status" class:busy={actionBusy}>{actionStatus}</div>
      {/if}
      <div class="jl-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .jl-bg { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 200; display: flex; align-items: flex-start; justify-content: center; padding: 12vh 16px 16px; }
  .jl {
    width: 560px; max-width: 100%;
    background: var(--surface-elevated, var(--bg)); border: 1px solid var(--line-strong);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    display: flex; flex-direction: column; max-height: 70vh;
    font-family: var(--font-body, system-ui);
  }
  .jl-search { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line-strong); }
  .jl-slash { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); border: 1px solid var(--line-strong); padding: 1px 5px; flex-shrink: 0; }
  .jl-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text-primary); font-size: var(--fs-body); }
  .jl-input::placeholder { color: var(--text-ghost); }

  .jl-body { overflow-y: auto; padding: 6px 0; }
  .jl-group { padding: 4px 0; }
  .jl-group-hd { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); padding: 4px 14px; }
  .jl-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 8px 14px; background: transparent; border: none; cursor: pointer; color: var(--text-primary); }
  .jl-item.sel { background: color-mix(in srgb, var(--accent-ink, var(--accent, #c4570a)) 14%, transparent); }
  .jl-code {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.04em;
    width: 40px; height: 30px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid currentColor; color: var(--text-muted);
  }
  .jl-code-0 { color: #c4570a; }
  .jl-code-1 { color: #2a7de1; }
  .jl-code-2 { color: #7a4ec2; }
  .jl-code-3 { color: #2a9d4a; }
  .jl-text { display: flex; flex-direction: column; min-width: 0; }
  .jl-label { font-size: var(--fs-nav); color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
  .jl-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink, var(--accent)); border: 1px solid currentColor; padding: 0 4px; text-transform: uppercase; }
  .jl-desc { font-size: var(--fs-label); color: var(--text-ghost); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .jl-empty { padding: 20px 14px; color: var(--text-ghost); font-size: var(--fs-nav); }

  .jl-status { padding: 8px 14px; border-top: 1px solid var(--line-strong); font-size: var(--fs-label); color: var(--status-success, #2a9d4a); }
  .jl-status.busy { color: var(--text-muted); }
  .jl-foot { display: flex; gap: 14px; padding: 8px 14px; border-top: 1px solid var(--line-strong); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .jl-foot kbd { font-family: var(--font-code); border: 1px solid var(--line-strong); padding: 0 3px; margin-right: 2px; }

  /* Mobile / PWA: give the panel room, drop the keyboard-hint footer on very
     small screens, and respect the notch. */
  @media (max-width: 640px) {
    .jl-bg { padding: 8vh 10px 10px; align-items: flex-start; }
    .jl { max-height: 80vh; }
    .jl-input { font-size: var(--fs-body); } /* ≥16px stops iOS auto-zoom on focus */
    .jl-foot { display: none; }
    .jl-desc { white-space: normal; }
  }
</style>
