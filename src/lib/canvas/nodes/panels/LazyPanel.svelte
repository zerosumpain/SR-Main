<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import { loadPanel, type PanelProps } from './registry';

  let {
    type,
    config,
    onChange,
    definition,
    nodeId,
    workflowId,
    upstreamFields,
  }: PanelProps & { type: string; definition?: NodeDefinition } = $props();

  let panelPromise = $derived(loadPanel(type, definition));
</script>

{#await panelPromise}
  <p class="panel-status" aria-live="polite">Loading settings…</p>
{:then Panel}
  <Panel
    {config}
    {onChange}
    {definition}
    {nodeId}
    {workflowId}
    {upstreamFields}
  />
{:catch}
  <p class="panel-status panel-error" role="alert">Settings could not be loaded.</p>
{/await}

<style>
  .panel-status {
    margin: 0;
    padding: 0.75rem;
    color: var(--ink-muted, #6b7280);
    font-size: 0.8rem;
  }

  .panel-error {
    color: var(--danger, #b42318);
  }
</style>
