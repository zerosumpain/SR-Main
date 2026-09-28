<script lang="ts">
  /**
   * The owner's switches for the travel desk's phone nudges, one per kind.
   * All off until switched on. How they arrive (phone, WhatsApp) is the
   * "Family travel" category's route, set on the phone like every other.
   */
  import { enhance } from '$app/forms';

  let { settings, labels }: { settings: Record<string, boolean>; labels: Record<string, string> } = $props();
  let saved = $state(false);
  let form: HTMLFormElement | undefined = $state();
</script>

<form
  class="ns"
  method="POST"
  action="?/notify"
  bind:this={form}
  use:enhance={() => async ({ result, update }) => {
    saved = result.type === 'success';
    await update({ reset: false, invalidateAll: false });
  }}
>
  <p class="ns-title">Tell my phone when…</p>
  {#each Object.entries(labels) as [kind, label] (kind)}
    <label>
      <input type="checkbox" name={kind} checked={settings[kind]} onchange={() => form?.requestSubmit()} />
      <span>{label}</span>
    </label>
  {/each}
  <noscript><button type="submit">Save</button></noscript>
  {#if saved}<span class="ns-saved" role="status">Saved</span>{/if}
</form>

<style>
  .ns {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line-strong);
    display: grid;
    gap: 6px;
  }
  .ns-title {
    margin: 0 0 2px;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: var(--fs-body-sm);
    cursor: pointer;
  }
  input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .ns-saved {
    font: 600 var(--fs-label-xs) var(--font-mono);
    color: var(--good);
  }
</style>
