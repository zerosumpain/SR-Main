<script lang="ts">
  import type { EstatePayload } from '../../dfe-data-estate/lib/types';

  let { estate }: { estate: EstatePayload | null } = $props();
  const fmt = (n: number) => n.toLocaleString('en-GB');
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const anyLive = $derived(!!estate && estate.stats.some((s) => s.live));
</script>

{#if estate}
  <div class="es">
    <div class="es-head">
      <span class="es-dot" class:live={anyLive}></span>
      <span class="es-lab">{anyLive ? 'Live from DfE’s public data services' : 'DfE data estate (last known)'}</span>
      <a class="es-more" href="/projects/dfe-data-estate">The Data Estate, in full →</a>
    </div>
    <div class="es-stats">
      {#each estate.stats as s (s.id)}
        <a class="stat" href={s.sourceUrl} target="_blank" rel="noopener" title={`${s.source} · ${s.api}${s.live ? '' : ` (snapshot, ${s.asOf})`}`}>
          <span class="s-val">{fmt(s.value)}</span>
          <span class="s-lab">{s.label}</span>
          <span class="s-src" class:live={s.live}>{s.live ? 'live' : 'snapshot'}</span>
        </a>
      {/each}
    </div>
    {#if estate.publications?.length}
      <div class="es-pubs">
        <span class="pubs-lab">Latest from Explore Education Statistics</span>
        <ul>
          {#each estate.publications.slice(0, 4) as p}
            <li><a href={p.url} target="_blank" rel="noopener">{p.title}</a>{#if p.lastPublished}<span class="pub-date"> · {fmtDate(p.lastPublished)}</span>{/if}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .es { border: 1px solid rgba(28,22,17,0.12); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 14px 16px; }
  .es-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .es-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(28,22,17,0.3); }
  .es-dot.live { background: #2f7d4f; box-shadow: 0 0 0 3px rgba(47,125,79,0.18); }
  .es-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.6); }
  .es-more { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .es-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .stat { display: flex; flex-direction: column; gap: 1px; border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; background: rgba(255,255,255,0.5); padding: 9px 11px; text-decoration: none; }
  .stat:hover { background: rgba(255,255,255,0.8); }
  .s-val { font-family: 'Fraunces', serif; font-size: 21px; font-weight: 600; color: var(--ink); line-height: 1.05; }
  .s-lab { font-size: 11px; line-height: 1.3; color: rgba(28,22,17,0.7); }
  .s-src { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.4); margin-top: 2px; }
  .s-src.live { color: #2f7d4f; }
  .es-pubs { margin-top: 12px; border-top: 1px dotted rgba(28,22,17,0.15); padding-top: 10px; }
  .pubs-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .es-pubs ul { margin: 6px 0 0; padding-left: 16px; }
  .es-pubs li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); margin-bottom: 2px; }
  .es-pubs a { color: #2f6f97; text-decoration: none; }
  .es-pubs a:hover { text-decoration: underline; }
  .pub-date { color: rgba(28,22,17,0.45); font-family: 'JetBrains Mono', monospace; font-size: 10px; }
</style>
