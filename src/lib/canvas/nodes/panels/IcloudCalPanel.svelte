<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import CredentialPicker from '$lib/canvas/nodes/panels/widgets/CredentialPicker.svelte';
  import CredentialStatusBanner from '$lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte';

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
<section class="config-section">
  <h3>Authentication</h3>
  <div class="field">
    <label>iCloud Credential <span class="req">*</span></label>
      <p class="hint">Apple ID email + app-specific password. Create at /admin/integrations with type 'icloud-cal' and kind 'basic'.</p>
    <CredentialPicker integrationType="icloud-cal" value={config.credentialId as string | undefined} onChange={(id) => set('credentialId', id)} />
  </div>
</section>

<section class="config-section">
  <h3>Action</h3>
  <div class="field">
    <label>Operation <span class="req">*</span></label>
      <p class="hint">What to do</p>
    <select class="nm-text-input" value={(config.operation as string | undefined) ?? ''} onchange={(e) => set('operation', (e.currentTarget as HTMLSelectElement).value)}><option value="fetch_events">Fetch Events</option><option value="list_calendars">List Calendars</option></select>
  </div>
</section>

{#if evalCond({'kind':'eq','field':'operation','value':'fetch_events'})}
<section class="config-section">
  <h3>Calendar</h3>
  <p class="section-intro">Use the 'List Calendars' operation first to discover available calendar URLs, then paste one here.</p>
  <div class="field">
    <label>Calendar URL</label>
      <p class="hint">Full CalDAV calendar URL from the list_calendars operation.</p>
    <input class="nm-text-input" type="text" placeholder="https://pXX-caldav.icloud.com/.../calendar/" value={(config.calendarUrl as string | undefined) ?? ''} oninput={(e) => set('calendarUrl', (e.currentTarget as HTMLInputElement).value)} />
  </div>
</section>
{/if}

{#if evalCond({'kind':'eq','field':'operation','value':'fetch_events'})}
<section class="config-section">
  <h3>Time Range</h3>
  <div class="field">
    <label>Days</label>
      <p class="hint">How many days to look ahead (and back from now). Default: 7.</p>
    <input class="nm-text-input" type="text" placeholder="" value={(config.days as string | undefined) ?? ''} oninput={(e) => set('days', (e.currentTarget as HTMLInputElement).value)} />
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