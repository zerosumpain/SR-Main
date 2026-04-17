<script lang="ts">
  import ModelPicker from './ModelPicker.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let {
    open = $bindable(),
    defaultModel,
    oncreate,
  }: {
    open: boolean;
    defaultModel: ModelContext;
    oncreate: (ctx: ModelContext) => void;
  } = $props();

  let model = $state<ModelContext>({ ...defaultModel });

  function start() {
    oncreate(model);
    open = false;
  }
  function cancel() {
    open = false;
  }
</script>

{#if open}
  <div
    class="backdrop"
    onclick={cancel}
    onkeydown={(e) => { if (e.key === 'Escape') cancel(); }}
    role="presentation"
  >
    <div
      class="dialog"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conv-title"
      tabindex="-1"
    >
      <h3 id="new-conv-title">New conversation</h3>
      <ModelPicker bind:value={model} label="Model" />
      <p class="hint">Once the conversation is started, the model is locked.</p>
      <div class="row">
        <button onclick={cancel}>Cancel</button>
        <button class="primary" onclick={start}>Start</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; z-index: 50; }
  .dialog { background: white; border-radius: 8px; padding: 1.25rem; min-width: 340px; display: flex; flex-direction: column; gap: 0.75rem; }
  .hint { color: #666; font-size: 0.85rem; margin: 0; }
  .row { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .primary { font-weight: 600; }
</style>
