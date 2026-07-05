<svelte:head><title>jkai approvals — Admin</title></svelte:head>
<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let defaultAction = $state(data.settings.defaultAction);
  let autoSelectSeconds = $state(Math.round(data.settings.autoSelectMs / 1000));
  let saving = $state(false);
</script>

<PageWrap>
  <PageHeader title="jkai approvals" />

  <div class="nm-sec">
    <h2 class="mb-2 text-sm uppercase tracking-wide" style="color:var(--text-secondary)">Default action on approval prompts</h2>
    <p class="text-xs mb-4" style="color:var(--text-secondary)">
      Hermes pauses with an in-chat approval banner whenever the agent tries to run a
      command its guardrails flag as dangerous. When the user hasn't clicked a button after
      <strong>{autoSelectSeconds}s</strong>, the chat UI silently fires this default in their place. Set to
      <em>“None — wait for user”</em> to disable auto-select entirely (buttons still render).
    </p>

    <form
      method="POST"
      action="?/save"
      use:enhance={() => {
        saving = true;
        return async ({ update }) => {
          await update({ reset: false });
          saving = false;
        };
      }}
      class="space-y-4"
    >
      <label class="block">
        <span class="block text-xs uppercase tracking-wide mb-1" style="color:var(--text-secondary)">Default action</span>
        <select bind:value={defaultAction} name="defaultAction" class="nm-text-input">
          <option value="none">None — wait for user</option>
          <option value="approve">Approve (once)</option>
          <option value="approve_always">Approve always (allowlist)</option>
          <option value="deny">Deny</option>
        </select>
      </label>

      <label class="block">
        <span class="block text-xs uppercase tracking-wide mb-1" style="color:var(--text-secondary)">Auto-select countdown (seconds)</span>
        <input
          type="number"
          name="autoSelectSeconds"
          min="3"
          max="600"
          bind:value={autoSelectSeconds}
          class="nm-text-input"
        />
        <span class="block text-xs mt-1" style="color:var(--text-secondary)">
          Allowed: 3-600. Ignored when default action is “None”.
        </span>
      </label>

      <button class="nm-save-btn" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      {#if form?.saved}<span class="ml-3 text-xs" style="color:var(--accent)">Saved.</span>{/if}
      {#if form?.error}<span class="ml-3 text-xs" style="color:var(--error)">Error: {form.error}</span>{/if}
    </form>
  </div>
</PageWrap>
