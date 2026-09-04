<script lang="ts">
  import { enhance } from '$app/forms';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Activity sources — Admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader kicker="Admin · Connections" title="ACTIVITY SOURCES" sub="Provider capability, evidence quality, credentials and rollout gates." />

  <section class="master">
    <div><span>Fabric</span><strong>{data.enabled ? 'Enabled' : 'Staged off'}</strong><p>All activity jobs require this switch and an independently enabled provider.</p><span>Credential vault</span><strong class:ready={data.vaultConfigured}>{data.vaultConfigured ? 'Ready' : 'Missing'}</strong><p>Account tokens, authorization state and archives require a valid INTEGRATION_CREDENTIALS_KEY.</p></div>
    <form method="POST" action="?/setFabric" use:enhance>
      <input type="hidden" name="enabled" value={data.enabled ? 'false' : 'true'} />
      <button>{data.enabled ? 'Pause fabric' : 'Enable fabric'}</button>
    </form>
  </section>

  <section class="catalogue">
    <div class="section-head"><span>Provider catalogue</span><a href="/jkai/sources">Open user view →</a></div>
    <div class="providers">
      {#each data.providers as provider (provider.id)}
        <article>
          <div class="provider-head"><strong>{provider.name}</strong><span>{provider.availability.replaceAll('_', ' ')}</span></div>
          <p>{provider.availabilityNote}</p>
          <dl>
            <div><dt>Modes</dt><dd>{provider.modes.join(' · ')}</dd></div>
            <div><dt>Evidence</dt><dd>{provider.evidenceModes.join(' · ')}</dd></div>
            <div><dt>Backfill</dt><dd>{provider.supportsBackfill ? 'yes' : 'no'}</dd></div>
            <div><dt>Enabled</dt><dd>{provider.enabled ? 'yes' : 'no'}</dd></div>
          </dl>
          {#if data.credentialState[provider.id]?.length}
            <ul class="secrets">
              {#each data.credentialState[provider.id] as secret (secret.name)}
                <li class:ready={secret.configured}><span>{secret.configured ? 'READY' : 'MISSING'}</span>{secret.name}</li>
              {/each}
            </ul>
          {:else}
            <p class="no-secret">No operator secret required.</p>
          {/if}
          {#if provider.policyGate}<p class="policy">{provider.policyGate}</p>{/if}
          <form method="POST" action="?/setProvider" use:enhance>
            <input type="hidden" name="provider" value={provider.id} />
            <input type="hidden" name="enabled" value={provider.enabled ? 'false' : 'true'} />
            <button disabled={provider.availability !== 'available' && provider.availability !== 'beta'}>{provider.enabled ? 'Disable' : 'Enable provider'}</button>
          </form>
        </article>
      {/each}
    </div>
  </section>
</PageWrap>

<style>
  .master { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 16px; border: 1px solid var(--line-strong); }
  .master div { display: grid; grid-template-columns: auto auto; gap: 5px 12px; }
  .master span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-ghost); }
  .master strong { color: var(--text-primary); }
  .master strong.ready { color: var(--success, #2d7a3a); }
  .master p { grid-column: 1 / -1; margin: 0; color: var(--text-muted); font-size: var(--fs-label-xs); }
  button { padding: 6px 10px; border: 1px solid var(--accent, #c4570a); border-radius: 0; background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; cursor: pointer; }
  button:disabled { border-color: var(--line-strong); color: var(--text-ghost); cursor: default; }
  .catalogue { margin-top: 28px; }
  .section-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 9px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-muted); }
  .section-head a { color: var(--accent, #c4570a); text-decoration: none; }
  .providers { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  article { display: flex; flex-direction: column; min-height: 330px; padding: 16px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .provider-head { display: flex; justify-content: space-between; gap: 12px; }
  .provider-head strong { font-family: var(--font-display); font-size: 24px; font-weight: 500; }
  .provider-head span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-ghost); }
  article > p { margin: 7px 0 13px; color: var(--text-muted); font-size: var(--fs-label-xs); line-height: 1.45; }
  dl { margin: 0; }
  dl div { display: grid; grid-template-columns: 80px 1fr; gap: 10px; padding: 4px 0; border-top: 1px solid var(--line-subtle, var(--line-strong)); }
  dt, dd { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  dt { color: var(--text-ghost); text-transform: uppercase; }
  dd { overflow-wrap: anywhere; }
  .secrets { list-style: none; margin: 13px 0 0; padding: 0; }
  .secrets li { display: flex; gap: 8px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .secrets span { width: 56px; color: var(--error, #a33); }
  .secrets li.ready span { color: var(--success, #2d7a3a); }
  .no-secret { color: var(--text-ghost); }
  article > .policy { color: var(--accent, #c4570a); }
  article form { margin-top: auto; padding-top: 14px; }
  @media (max-width: 720px) {
    .providers { grid-template-columns: 1fr; }
    .master { align-items: flex-start; flex-direction: column; }
  }
</style>
