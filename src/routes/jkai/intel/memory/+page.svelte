<script lang="ts">
  import { onMount } from 'svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  interface Memory { id: string; content: string; category: string; createdAt: string; updatedAt: string; supersededBy: string | null; provenance: { origin?: string; assertion?: string; sourceId?: string; pinned?: boolean; validFrom?: string; validUntil?: string } | null; recalledBecause: string; entities: Array<{ id: string; name: string }> }
  let memories = $state<Memory[]>([]), query = $state(''), asOf = $state(''), message = $state(''), busy = $state(false);
  let content = $state(''), category = $state('preferences'), editing = $state<string | null>(null), validFrom = $state(''), validUntil = $state('');
  let linkTarget = $state<string | null>(null), entityQuery = $state(''), entityResults = $state<Array<{id:string;name:string;type:string}>>([]);
  async function load() {
    busy=true;
    try { const r=await fetch(`/api/jkai/memory?q=${encodeURIComponent(query)}&asOf=${encodeURIComponent(asOf)}`); const b=await r.json(); if(!r.ok)throw new Error(b.message); memories=b.memories; }
    catch(e){message=e instanceof Error?e.message:'Unable to load memories';}finally{busy=false;}
  }
  async function act(body: Record<string,unknown>) {
    busy=true;message='';
    try { const r=await fetch('/api/jkai/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const b=await r.json();if(!r.ok)throw new Error(b.message);message='Memory updated';await load();return true; }
    catch(e){message=e instanceof Error?e.message:'Unable to update memory';return false;}finally{busy=false;}
  }
  async function save(){if(await act({action:editing?'correct':'save',id:editing??undefined,content,category,validFrom:validFrom||undefined,validUntil:validUntil||undefined})){content='';editing=null;validFrom='';validUntil='';}}
  async function searchEntities(){const r=await fetch(`/api/jkai/memory?entities=${encodeURIComponent(entityQuery)}`);if(r.ok)entityResults=(await r.json()).entities;}
  onMount(load);
</script>
<svelte:head><title>Memory · JKAI</title></svelte:head>
<div class="memory-page">
  <JkaiPageTitle title="Memory" />
  <p>Personal context, connected to your intelligence graph.</p>
  <div class="toolbar">
    <label>Recall <input class="nm-text-input" bind:value={query} placeholder="Person, project, preference…" onkeydown={e=>{if(e.key==='Enter')load();}} /></label>
    <label>Valid on <input class="nm-text-input" type="date" bind:value={asOf}/></label>
    <button class="nm-btn-ghost" onclick={load} disabled={busy}>Search</button>
    <a href="/api/jkai/memory?format=md">Export Markdown</a>
    <button class="nm-btn-ghost" onclick={()=>act({action:'backfill'})} disabled={busy}>Link existing memories</button>
  </div>
  {#if message}<p role="status">{message}</p>{/if}
  <details class="editor" open={editing!==null}>
    <summary>{editing?'Correct memory':'Remember something'}</summary>
    <label>Memory <textarea class="nm-text-input" bind:value={content} rows="3"></textarea></label>
    <div class="toolbar">
      <label>Category <select class="nm-select" bind:value={category}>{#each ['people','preferences','places','health','devices','situations','patterns'] as c}<option value={c}>{c}</option>{/each}</select></label>
      <label>Valid from <input class="nm-text-input" type="date" bind:value={validFrom}/></label>
      <label>Valid until <input class="nm-text-input" type="date" bind:value={validUntil}/></label>
      <button class="nm-save-btn" disabled={busy||!content.trim()} onclick={save}>Save</button>
      {#if editing}<button class="nm-btn-ghost" onclick={()=>{editing=null;content='';}}>Cancel</button>{/if}
    </div>
  </details>
  <p class="meta">{memories.length} memories · Pinned facts are included in core context. Other memories are recalled when relevant.</p>
  {#if !memories.length&&!busy}<p>No personal memories match this view.</p>{/if}
  {#each memories as m (m.id)}
    <article>
      <div class="meta">{m.category} · {m.provenance?.origin??'legacy'} · {m.provenance?.assertion??'unverified'}{m.provenance?.pinned?' · PINNED':''}{m.supersededBy?' · HISTORICAL':''}</div>
      <p>{m.content}</p>
      <div class="meta">{m.recalledBecause} · Recorded {new Date(m.createdAt).toLocaleDateString()} · Valid {m.provenance?.validFrom?.slice(0,10)??m.createdAt.slice(0,10)} to {m.provenance?.validUntil?.slice(0,10)??'open'}</div>
      <div class="toolbar">{#each m.entities as e}<a href={`/jkai/intel/entities/${e.id}`}>{e.name}</a>{/each}</div>
      <details><summary>Source and controls</summary><p class="meta">Source: {m.provenance?.sourceId?.startsWith('memory-editor:')?'Saved in the memory editor':m.provenance?.sourceId??'No original source recorded'}</p>
        <div class="toolbar">
          <button class="nm-btn-ghost" disabled={busy||!!m.supersededBy} onclick={()=>act({action:'pin',id:m.id,pinned:!m.provenance?.pinned})}>{m.provenance?.pinned?'Unpin':'Pin'}</button>
          <button class="nm-btn-ghost" disabled={!!m.supersededBy} onclick={()=>{editing=m.id;content=m.content;category=m.category;validFrom='';validUntil='';}}>Correct</button>
          <button class="nm-btn-ghost" onclick={()=>{linkTarget=m.id;entityResults=[];entityQuery='';}}>Edit entity links</button>
          <button class="nm-btn-ghost" disabled={busy} onclick={()=>act({action:'forget',id:m.id})}>Forget</button>
        </div>
        {#if linkTarget===m.id}<div class="editor"><label>Find entity <input class="nm-text-input" bind:value={entityQuery}/></label><button class="nm-btn-ghost" onclick={searchEntities}>Find</button>
          {#each entityResults as e}<button class="nm-btn-ghost" disabled={busy||m.entities.some(x=>x.id===e.id)} onclick={()=>act({action:'link',id:m.id,entityIds:[...m.entities.map(x=>x.id),e.id]})}>Link {e.name} ({e.type})</button>{/each}
          {#each m.entities as e}<button class="nm-btn-ghost" onclick={()=>act({action:'link',id:m.id,entityIds:m.entities.filter(x=>x.id!==e.id).map(x=>x.id)})}>Unlink {e.name}</button>{/each}
        </div>{/if}
      </details>
    </article>
  {/each}
</div>
<style>
  .memory-page{height:100%;overflow:auto;min-height:0;padding:1.5rem;max-width:70rem;width:100%;margin:auto;box-sizing:border-box;}
  .toolbar{display:flex;flex-wrap:wrap;gap:.75rem;align-items:end;margin:.75rem 0;}
  label{display:flex;flex-direction:column;gap:.35rem;font-size:var(--fs-label);}
  article,.editor{border-top:1px solid var(--line-strong);padding:1rem 0;}
  article p{line-height:1.55;overflow-wrap:anywhere;}
  .meta{font-size:var(--fs-label);color:var(--text-muted);overflow-wrap:anywhere;}
  textarea{width:100%;box-sizing:border-box;} summary{cursor:pointer;} a{color:var(--accent-ink);}
  @media(max-width:600px){.memory-page{padding:1rem}.toolbar label{width:100%}}
</style>
