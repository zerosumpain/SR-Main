<script lang="ts">
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import { onMount } from 'svelte';

  // Today's digest, surfaced where the day starts. The briefing engine has run
  // every morning for a while, but /jkai/daydreams/briefing was palette-only so it went
  // unread. Dismissal is per-briefing and local — a new digest reappears.
  let {
    briefing,
  }: {
    briefing: { id: string; title: string; markdown: string; startedAt: string };
  } = $props();

  const STORAGE_KEY = 'jkai.briefing.dismissed';

  let dismissed = $state(true); // assume dismissed until localStorage says otherwise (no SSR flash)
  let expanded = $state(false);

  onMount(() => {
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === briefing.id;
    } catch {
      dismissed = false;
    }
  });

  function dismiss() {
    dismissed = true;
    try {
      localStorage.setItem(STORAGE_KEY, briefing.id);
    } catch {
      /* private mode — the card just returns next reload */
    }
  }

  const when = $derived(
    new Date(briefing.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  );
</script>

{#if !dismissed}
  <section class="bc" aria-label="Today's briefing">
    <header class="bc-hd">
      <span class="bc-kicker">Briefing · {when}</span>
      <span class="bc-title">{briefing.title}</span>
      <div class="bc-actions">
        <button class="bc-btn" onclick={() => (expanded = !expanded)}>{expanded ? 'Collapse' : 'Read'}</button>
        <a class="bc-btn" href="/jkai/daydreams/briefing">Open</a>
        <button class="bc-btn bc-x" onclick={dismiss} aria-label="Dismiss today's briefing">✕</button>
      </div>
    </header>
    {#if expanded}
      <div class="bc-body"><ChatMarkdown content={briefing.markdown} /></div>
    {/if}
  </section>
{/if}

<style>
  .bc {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent-ink, var(--accent, #c4570a));
    background: var(--card-bg);
    padding: 10px 12px;
    margin: 0 0 12px;
  }
  .bc-hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .bc-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent-ink, var(--accent));
    flex-shrink: 0;
  }
  .bc-title {
    font-size: var(--fs-nav);
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bc-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .bc-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--line-strong);
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
  }
  .bc-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .bc-x {
    padding: 3px 6px;
  }
  .bc-body {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--divider, var(--card-border));
    max-height: 40vh;
    overflow-y: auto;
    font-size: var(--fs-nav);
  }
</style>
