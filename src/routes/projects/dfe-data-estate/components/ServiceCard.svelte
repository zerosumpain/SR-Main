<script lang="ts">
  import type { Service } from '../lib/services';

  let { service }: { service: Service } = $props();

  const rows = $derived([
    { k: 'Source', v: service.upstream },
    { k: 'Refresh', v: service.refresh },
    { k: 'Owner', v: service.owner },
    { k: 'Access', v: service.access },
    { k: 'API', v: service.api },
    { k: 'Licence', v: service.licence }
  ]);
</script>

<article class="card tier-{service.tier}">
  <header class="hd">
    <div class="title">
      <h3>{service.name}</h3>
      {#if service.acronym}<span class="acr">{service.acronym}</span>{/if}
    </div>
    {#if service.hasOpenApi}<span class="open-api" title="Genuinely public API, no key required">open API</span>{/if}
  </header>

  <p class="purpose">{service.purpose}</p>

  <dl class="fields">
    {#each rows as row (row.k)}
      <dt>{row.k}</dt>
      <dd>{row.v}</dd>
    {/each}
  </dl>

  {#if service.highlight}<p class="hi">◆ {service.highlight}</p>{/if}
  {#if service.note}<p class="note">{service.note}</p>{/if}

  <footer class="ft">
    <a href={service.url} target="_blank" rel="noopener">Visit ↗</a>
    {#if service.docsUrl}<a href={service.docsUrl} target="_blank" rel="noopener">Docs / data ↗</a>{/if}
  </footer>
</article>

<style>
  .card {
    --tier: #2f7d4f;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 15px 16px 13px;
    background: rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-left: 3px solid var(--tier);
    border-radius: 9px;
    min-width: 0;
  }
  .tier-open { --tier: #2f7d4f; }
  .tier-secure { --tier: #b1455e; }
  .tier-gateway { --tier: #2f6f97; }

  .hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 16px;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: #1c1611;
  }
  .acr {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.05em;
    color: rgba(28, 22, 17, 0.5);
    padding: 1px 5px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: 4px;
    white-space: nowrap;
  }
  .open-api {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #c4570a;
    background: rgba(196, 87, 10, 0.1);
    padding: 2px 6px;
    border-radius: 999px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .purpose {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.74);
  }
  .fields {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 3px 12px;
    margin: 2px 0 0;
  }
  dt {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
    padding-top: 1px;
  }
  dd {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: rgba(28, 22, 17, 0.82);
  }
  .hi {
    margin: 4px 0 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: var(--tier);
    line-height: 1.4;
  }
  .note {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.55);
    border-left: 2px solid rgba(28, 22, 17, 0.14);
    padding-left: 8px;
    font-style: italic;
  }
  .ft {
    display: flex;
    gap: 14px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid rgba(28, 22, 17, 0.08);
  }
  .ft a {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.04em;
    color: rgba(28, 22, 17, 0.62);
    text-decoration: none;
    border-bottom: 1px dashed rgba(28, 22, 17, 0.3);
  }
  .ft a:hover {
    color: #c4570a;
    border-bottom-color: #c4570a;
  }
</style>
