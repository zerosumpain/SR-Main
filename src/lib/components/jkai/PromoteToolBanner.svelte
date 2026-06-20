<script lang="ts">
  import type { PromoteMarker } from '$lib/jkai/promote-marker';

  let { messageId, marker }: { messageId: string; marker: PromoteMarker } = $props();

  let status = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let errorMsg = $state<string | null>(null);
  let editing = $state(false);
  // nameInput is user-editable; initialise once from the prop value
  // eslint-disable-next-line svelte/valid-prop-bindings
  let nameInput = $state('');
  $effect.pre(() => {
    if (nameInput === '') nameInput = marker.proposedName;
  });

  async function promote() {
    status = 'saving';
    errorMsg = null;
    try {
      const res = await fetch('/api/jkai/tools/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId,
          toolCallId: marker.toolCallId,
          name: nameInput,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      status = 'saved';
    } catch (err) {
      status = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="promote-banner" class:saved={status === 'saved'}>
  {#if status === 'saved'}
    <span>✓ Saved as <code>{nameInput}</code></span>
  {:else}
    <span>Save this as a reusable tool?</span>
    {#if editing}
      <input bind:value={nameInput} placeholder="tool_name" />
    {:else}
      <code>{nameInput}</code>
      <button onclick={() => (editing = true)} type="button" class="link">rename</button>
    {/if}
    <button onclick={promote} disabled={status === 'saving'} type="button" class="primary">
      {status === 'saving' ? 'Saving…' : 'Save as tool'}
    </button>
    {#if errorMsg}
      <span class="error">{errorMsg}</span>
    {/if}
  {/if}
</div>

<style>
  .promote-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    margin: 0.4rem 0;
    font-size: 0.85rem;
    border: 1px dashed var(--card-border);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  .promote-banner.saved {
    border-style: solid;
    opacity: 0.7;
  }
  .primary {
    padding: 0.25rem 0.6rem;
    border-radius: var(--radius-round);
    background: var(--accent);
    color: white;
    border: none;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  input {
    padding: 0.2rem 0.4rem;
    font: inherit;
  }
  code {
    font-family: monospace;
    background: var(--surface-overlay);
    padding: 0 0.3rem;
    border-radius: var(--radius-sharp);
  }
  .error { color: var(--error); }
</style>
