<script lang="ts">
  // Shown when a reply carries a [[code-route: "…"]] marker: the ask could be a
  // real app or a snippet, and only the user knows which they wanted.
  //
  // Both buttons are silent sends rather than direct API calls, following
  // SlashCommandButtonBar. Build goes back through the agent so `build_create`
  // picks the model, budget and toolsets exactly as it does for any other build,
  // and the resulting id lands in the thread as a BuildPill with no new wiring.
  import type { CodeRouteMarker } from '$lib/jkai/code-route-marker';

  let {
    marker,
    onSilentSend,
    isLatest = true,
  }: {
    marker: CodeRouteMarker;
    onSilentSend: (message: string) => void | Promise<void>;
    /** Only the newest offer is live; older ones freeze so history reads honestly. */
    isLatest?: boolean;
  } = $props();

  let chosen = $state<string | null>(null);

  function choose(label: string, message: string): void {
    if (chosen || !isLatest) return;
    chosen = label;
    void onSilentSend(message);
  }

  const buildMsg = $derived(
    `Build that as an app with the autonomous builder — call build_create with this brief: ${marker.brief}`,
  );
  const chatMsg = $derived(
    `Don't start a build. Write it here in the chat as a code block: ${marker.brief}`,
  );
</script>

<div class="cr-card" class:done={chosen !== null}>
  {#if chosen}
    <span class="cr-status">✓ {chosen}</span>
  {:else}
    <span class="cr-q">
      {#if isLatest}
        Build this as a real app, or just write the code here?
      {:else}
        <span class="cr-stale">— answered by what followed —</span>
      {/if}
    </span>
    {#if isLatest}
      <span class="cr-spacer"></span>
      <button type="button" class="cr-btn cr-secondary" onclick={() => choose('Code in chat', chatMsg)}>
        Just show the code
      </button>
      <button type="button" class="cr-btn cr-primary" onclick={() => choose('Building it', buildMsg)}>
        Build it as an app
      </button>
    {/if}
  {/if}
</div>

<style>
  .cr-card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 6px 0;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--card-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .cr-card.done {
    border-style: solid;
    opacity: 0.7;
  }
  .cr-q { color: var(--text-secondary); }
  .cr-stale { color: var(--text-muted); }
  .cr-spacer { flex: 1; }
  .cr-status {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .cr-btn {
    padding: 4px 12px;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .cr-btn:hover { opacity: 0.85; }
  /* Writing it in chat is the cheap, reversible option, so it reads as the
     quiet default; a build spends real money and gets the deliberate button. */
  .cr-secondary {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--line-strong);
  }
  .cr-primary {
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    font-weight: 600;
  }
</style>
