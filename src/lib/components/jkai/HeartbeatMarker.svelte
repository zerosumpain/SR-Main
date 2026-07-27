<script lang="ts" module>
  // A run of heartbeat-engine messages, collapsed to one marker.
  //
  // The heartbeat engine posts into the thread on its own cadence — progress
  // notes ("orchestrator paused 2 min ago — waiting on your reply") and short
  // LLM replies. Rendered as bubbles they dominate a thread they contributed
  // nothing to, and consecutive ones repeat almost verbatim. So a contiguous run
  // becomes a single quiet marker: the detail is on hover, and a click pins it
  // open for reading or copying.

  export interface HeartbeatEntry {
    id: string;
    kind: 'note' | 'reply';
    activity: string;
    content: string;
    createdAt?: string;
  }
</script>

<script lang="ts">
  let { entries }: { entries: HeartbeatEntry[] } = $props();

  let hovered = $state(false);
  let pinned = $state(false);
  const open = $derived(hovered || pinned);

  // Plain `let`, never $state: written by the show/hide helpers that the pointer
  // handlers call, and nothing reactive reads it. As $state it would subscribe
  // any effect touching these helpers to its own write.
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function show(): void {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    hovered = true;
  }

  /** Small grace period so the pointer can travel from the icon to the card. */
  function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hovered = false;
      hideTimer = null;
    }, 120);
  }

  $effect(() => () => {
    if (hideTimer) clearTimeout(hideTimer);
  });

  function clockTime(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  const label = $derived(
    entries.length === 1 ? '1 heartbeat update' : `${entries.length} heartbeat updates`,
  );
</script>

<div
  class="hb-marker"
  onmouseenter={show}
  onmouseleave={scheduleHide}
  role="presentation"
>
  <button
    type="button"
    class="hb-icon"
    class:open
    aria-expanded={open}
    aria-label={label}
    title={label}
    onclick={() => (pinned = !pinned)}
    onfocus={show}
    onblur={scheduleHide}
  >
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <path d="M2 10h3.2l2-4.2 2.6 8.4 2.1-5.1 1.4 2.9H18" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    {#if entries.length > 1}
      <span class="hb-count">{entries.length}</span>
    {/if}
  </button>

  {#if open}
    <div class="hb-card" role="tooltip">
      <div class="hb-card-hd">
        <span>{label}</span>
        {#if pinned}
          <button type="button" class="hb-close" onclick={() => (pinned = false)} aria-label="Close">✕</button>
        {/if}
      </div>
      <ul class="hb-list">
        {#each entries as entry (entry.id)}
          <li class="hb-item">
            <div class="hb-item-hd">
              <span class="hb-kind" data-kind={entry.kind}>{entry.kind}</span>
              <span class="hb-activity">{entry.activity}</span>
              {#if clockTime(entry.createdAt)}
                <span class="hb-time">{clockTime(entry.createdAt)}</span>
              {/if}
            </div>
            <p class="hb-text">{entry.content}</p>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .hb-marker {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 1px 0;
  }

  .hb-icon {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 100px;
    color: var(--text-ghost);
    cursor: pointer;
    transition:
      color 0.2s ease-out,
      border-color 0.2s ease-out;
  }
  .hb-icon:hover,
  .hb-icon:focus-visible,
  .hb-icon.open {
    color: var(--accent);
    border-color: var(--accent-tint-20);
  }
  .hb-count {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
  }

  /* Opaque panel — --card-bg is a 7% tint and would let the thread show through.
     Sits above neighbouring bubbles so a long note isn't clipped by the next turn. */
  .hb-card {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    width: min(440px, calc(100vw - 48px));
    max-height: 320px;
    overflow-y: auto;
    padding: 9px 11px;
    background: var(--surface-elevated);
    border: 2px solid var(--card-border);
    border-radius: 2px;
    text-align: left;
  }
  .hb-card-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--divider);
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .hb-close {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-ghost);
    cursor: pointer;
    font-size: 11px;
  }
  .hb-close:hover {
    color: var(--accent);
  }

  .hb-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hb-item-hd {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 2px;
    font-family: var(--font-mono);
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .hb-kind[data-kind='reply'] {
    color: var(--accent);
  }
  .hb-activity {
    color: var(--text-secondary);
  }
  .hb-time {
    margin-left: auto;
  }
  .hb-text {
    margin: 0;
    font-family: var(--font-body);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
  }
</style>
