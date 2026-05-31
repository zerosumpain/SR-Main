<script lang="ts">
  import { onDestroy } from 'svelte';
  import { findAffordance, type SlashAffordance, type SlashButton } from '$lib/jkai/slash-commands';
  import type { ApprovalUiSettings } from '$lib/server/models/settings';

  let {
    content,
    /** Send a slash command to Hermes WITHOUT persisting it as a user message.
     *  The chat handler accepts `silent: true` for exactly this. */
    onSilentSend,
    /** Auto-select policy from admin settings. When `defaultAction !== 'none'`
     *  and this is the latest assistant message, fire that command after the
     *  configured countdown unless the user clicks first. */
    autoSelect,
    /** Only the most recent assistant message should run the auto-timer and
     *  remain clickable. Earlier prompts in history get static, disabled UI. */
    isLatest,
  }: {
    content: string;
    onSilentSend: (command: string) => void | Promise<void>;
    autoSelect?: ApprovalUiSettings;
    isLatest?: boolean;
  } = $props();

  // Map admin's `defaultAction` enum onto the registry command strings so a
  // schema change here doesn't ripple into the admin form.
  const DEFAULT_ACTION_TO_COMMAND: Record<ApprovalUiSettings['defaultAction'], string | null> = {
    approve: '/approve',
    approve_always: '/approve always',
    deny: '/deny',
    none: null,
  };

  const affordance = $derived<SlashAffordance | null>(findAffordance(content));
  let triggered = $state<string | null>(null);
  let countdownMs = $state<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let fireAt: number | null = null;

  function cleanupTimer(): void {
    if (timer) { clearInterval(timer); timer = null; }
    fireAt = null;
    countdownMs = null;
  }

  function trigger(button: SlashButton): void {
    if (triggered) return;
    triggered = button.label;
    cleanupTimer();
    onSilentSend(button.command);
  }

  function autoTrigger(): void {
    if (triggered || !affordance) return;
    const cmd = autoSelect ? DEFAULT_ACTION_TO_COMMAND[autoSelect.defaultAction] : null;
    if (!cmd) return;
    const matchingBtn = affordance.buttons.find((b) => b.command === cmd);
    if (matchingBtn) trigger(matchingBtn);
  }

  // Start the countdown when an unanswered approval lands as the latest
  // message. Stops if the user clicks, the message is no longer latest, or
  // admin's defaultAction is 'none'.
  $effect(() => {
    cleanupTimer();
    if (!affordance || triggered) return;
    if (!isLatest) return;
    const ms = autoSelect?.autoSelectMs ?? 0;
    const action = autoSelect?.defaultAction ?? 'none';
    if (!ms || action === 'none') return;

    fireAt = Date.now() + ms;
    countdownMs = ms;
    timer = setInterval(() => {
      if (fireAt === null) return;
      const remaining = fireAt - Date.now();
      if (remaining <= 0) {
        autoTrigger();
      } else {
        countdownMs = remaining;
      }
    }, 100);
  });

  onDestroy(() => cleanupTimer());

  function styleFor(s?: SlashButton['style']): string {
    switch (s) {
      case 'danger':
        // The action that proceeds with the dangerous command. Marked as a
        // caution (red outline) and deliberately NOT filled, so it can't
        // out-weigh the safe primary action above.
        return 'background: transparent; color: var(--danger, #b54242); border: 1px solid var(--danger, #b54242);';
      case 'subtle':
        return 'background: transparent; color: var(--text-secondary); border: 1px solid var(--card-border);';
      default:
        // Safe / recommended action — filled and bold so it's the dominant tap.
        return 'background: var(--accent); color: var(--bg); border: 1px solid var(--accent); font-weight: 600;';
    }
  }
</script>

{#if affordance}
  <div class="slash-bar" data-affordance={affordance.id}>
    {#if triggered}
      <span class="slash-status">✓ {triggered}{!isLatest ? ' (stale)' : ''}</span>
    {:else if !isLatest}
      <span class="slash-status muted">— resolved earlier —</span>
    {:else}
      {#each affordance.buttons as btn (btn.command)}
        <button
          type="button"
          class="slash-btn"
          style={styleFor(btn.style)}
          onclick={() => trigger(btn)}
        >
          {btn.label}
        </button>
      {/each}
      {#if countdownMs !== null && autoSelect && autoSelect.defaultAction !== 'none'}
        {@const matching = affordance.buttons.find((b) => b.command === DEFAULT_ACTION_TO_COMMAND[autoSelect.defaultAction])?.label}
        <span class="slash-countdown" title="Auto-select {matching ?? autoSelect.defaultAction} in {Math.ceil(countdownMs / 1000)}s">
          auto-{matching?.toLowerCase() ?? autoSelect.defaultAction} in {Math.ceil(countdownMs / 1000)}s
        </span>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .slash-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .slash-btn {
    padding: 4px 10px;
    border-radius: 3px;
    border: none;
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .slash-btn:hover { opacity: 0.85; }
  .slash-status {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .slash-status.muted { color: var(--text-secondary); }
  .slash-countdown {
    color: var(--text-secondary);
    margin-left: auto;
  }
</style>
