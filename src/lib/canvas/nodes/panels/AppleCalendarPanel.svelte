<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import CredentialPicker from '$lib/canvas/nodes/panels/widgets/CredentialPicker.svelte';
  import ResourcePicker from '$lib/canvas/nodes/panels/shared/ResourcePicker.svelte';
  import TemplatedInput from '$lib/canvas/nodes/panels/shared/TemplatedInput.svelte';
  import CredentialStatusBanner from '$lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte';
  import TestConnectionAction from '$lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte';

  interface Props {
    config: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
    definition?: NodeDefinition;
    nodeId?: string;
    workflowId?: string;
    upstreamFields?: string[];
  }
  let { config, onChange, definition, nodeId, workflowId, upstreamFields }: Props = $props();

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function evalCond(cond: any): boolean {
    if (!cond) return true;
    if (cond.kind === 'eq') return config[cond.field] === cond.value;
    if (cond.kind === 'neq') return config[cond.field] !== cond.value;
    if (cond.kind === 'in') return cond.values.includes(config[cond.field]);
    if (cond.kind === 'not-in') return !cond.values.includes(config[cond.field]);
    if (cond.kind === 'and') return cond.conditions.every(evalCond);
    if (cond.kind === 'or') return cond.conditions.some(evalCond);
    return true;
  }
</script>

<CredentialStatusBanner credentialId={config.credentialId as string | undefined} />
<TestConnectionAction integrationType="apple-calendar" credentialId={config.credentialId as string | undefined} />
<section class="config-section">
  <h3>Connection</h3>
  <p class="section-intro">Pick the iCloud account and calendar to operate on.</p>
  <div class="field">
    <label>iCloud account <span class="req">*</span></label>
    <CredentialPicker integrationType="apple-calendar" value={config.credentialId as string | undefined} onChange={(id) => set('credentialId', id)} />
  </div>
  <div class="field">
    <label>Calendar <span class="req">*</span></label>
    {#if config.credentialId}
      <ResourcePicker
        placeholder="pick a calendar"
        emptyHint="No calendars found — check your iCloud credential."
        value={config.calendar as string | undefined}
        onChange={(v) => set('calendar', v)}
        fetcher={async () => {
          const res = await fetch(`/api/integrations/options/apple-calendar/calendar?credentialId=${encodeURIComponent(config.credentialId as string)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return (data.options ?? []).map((o: any) => ({ value: o.value, label: o.label, meta: o.meta }));
        }}
      />
    {:else}
      <input class="nm-text-input" type="text" disabled placeholder="Select an iCloud account first" />
      <span class="hint">Pick a credential above to load calendars.</span>
    {/if}
  </div>
</section>

<section class="config-section">
  <h3>Operation</h3>
  <div class="field">
    <label>What to do <span class="req">*</span></label>
    <select class="nm-text-input" value={(config.operation as string | undefined) ?? ''} onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}><option value="list">List events</option><option value="create">Create event</option><option value="update">Update event</option><option value="delete">Delete event</option></select>
  </div>
</section>

{#if evalCond({'kind':'eq','field':'operation','value':'list'})}
<section class="config-section">
  <h3>Date range</h3>
  <div class="field">
    <label>From</label>
    <TemplatedInput value={(config.dateRangeStart as string | undefined) ?? ''} placeholder="ISO date or {{template}}" {upstreamFields} onChange={(v) => set('dateRangeStart', v)} />
  </div>
  <div class="field">
    <label>To</label>
    <TemplatedInput value={(config.dateRangeEnd as string | undefined) ?? ''} placeholder="ISO date or {{template}}" {upstreamFields} onChange={(v) => set('dateRangeEnd', v)} />
  </div>
</section>
{/if}

{#if evalCond({'kind':'in','field':'operation','values':['create','update']})}
<section class="config-section">
  <h3>Event details</h3>
  <div class="field">
    <label>Title</label>
    <TemplatedInput value={(config.eventTitle as string | undefined) ?? ''} placeholder="" {upstreamFields} onChange={(v) => set('eventTitle', v)} />
  </div>
  <div class="field">
    <label>Start</label>
    <TemplatedInput value={(config.eventStart as string | undefined) ?? ''} placeholder="" {upstreamFields} onChange={(v) => set('eventStart', v)} />
  </div>
  <div class="field">
    <label>End</label>
    <TemplatedInput value={(config.eventEnd as string | undefined) ?? ''} placeholder="" {upstreamFields} onChange={(v) => set('eventEnd', v)} />
  </div>
  <div class="field">
    <label>Location</label>
    <TemplatedInput value={(config.eventLocation as string | undefined) ?? ''} placeholder="" {upstreamFields} onChange={(v) => set('eventLocation', v)} />
  </div>
  <div class="field">
    <label>Notes</label>
    <TemplatedInput value={(config.eventNotes as string | undefined) ?? ''} placeholder="" {upstreamFields} onChange={(v) => set('eventNotes', v)} />
  </div>
</section>
{/if}

{#if evalCond({'kind':'in','field':'operation','values':['update','delete']})}
<section class="config-section">
  <h3>Target event</h3>
  <div class="field">
    <label>Event ID <span class="req">*</span></label>
    <input class="nm-text-input" type="text" placeholder="" value={(config.eventId as string | undefined) ?? ''} oninput={(e) => set('eventId', (e.currentTarget as HTMLInputElement).value)} />
  </div>
</section>
{/if}

<style>
  .config-section { margin-bottom: 1rem; }
  .config-section h3 { margin: 0 0 0.25rem; font-size: 0.85rem; font-weight: 600; }
  .section-intro { color: var(--nm-muted, #666); font-size: 0.85rem; margin: 0 0 0.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 0.5rem; }
  .field label { font-size: 0.85rem; }
  .req { color: var(--nm-status-error, #c0392b); }
  .hint { font-size: 0.8rem; color: var(--nm-muted, #666); margin: 0; }
</style>