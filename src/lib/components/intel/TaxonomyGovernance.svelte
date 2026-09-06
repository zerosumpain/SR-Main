<script lang="ts">
  import { onMount } from 'svelte';
  let { onchanged = () => {} }: { onchanged?: () => void } = $props();
  let kind=$state('type'), fromId=$state(''),intoId=$state(''),message=$state(''),busy=$state(false);
  let assessment=$state<{outcome:string;rationale:string;citations:Array<{ref:string;quote:string}>}|null>(null);
  async function assess(){busy=true;message='';try{const r=await fetch('/api/jkai/intel/taxonomy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assess',kind,fromId,intoId})});const b=await r.json();if(!r.ok)throw new Error(b.message??'Assessment unavailable');assessment=b;}catch(e){message=e instanceof Error?e.message:'Assessment unavailable';}finally{busy=false;}}
  let types=$state<Array<{id:string;name:string}>>([]),categories=$state<Array<{id:string;name:string}>>([]);
  let history=$state<Array<{id:string;kind:string;action:string;from_id:string;into_id:string;created_at:string;undone_at:string|null}>>([]);
  let links=$state<Array<{id:string;kind:string;relation:string;from_id:string;into_id:string}>>([]);
  let samples=$state<Array<{id:string;title:string;excerpt:string}>>([]),selected=$state<string[]>([]);
  const options=$derived(kind==='type'?types:categories);
  const label=(id:string)=>[...types,...categories].find(t=>t.id===id)?.name??id;
  async function load(){const r=await fetch('/api/jkai/intel/taxonomy');if(!r.ok){message='Unable to load taxonomy history';return;}const b=await r.json();types=b.types;categories=b.categories;history=b.history;links=b.links;}
  async function evidence(){selected=[];const r=await fetch(`/api/jkai/intel/taxonomy?kind=${kind}&evidence=${encodeURIComponent(fromId)}`);if(r.ok)samples=(await r.json()).samples;else message='Unable to load examples';}
  async function change(action:string,id?:string){busy=true;message='';try{const r=await fetch('/api/jkai/intel/taxonomy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action==='broader'||action==='related'?'relate':action,relation:action,kind,fromId,intoId,id,memberIds:selected})});if(!r.ok)throw new Error((await r.json()).message??'Change failed');await load();onchanged();message='Taxonomy updated';}catch(e){message=e instanceof Error?e.message:'Change failed';}finally{busy=false;}}
  onMount(load);
</script>
<section>
  <h2>Relationships and change history</h2>
  <p>Inspect examples before deciding whether meanings are equivalent, narrower, or related. Select individual members to correct mixed categories.</p>
  <div class="toolbar">
    <label>Vocabulary <select bind:value={kind} onchange={()=>{fromId='';intoId='';samples=[];}}><option value="type">Entity types</option><option value="category">Source categories</option></select></label>
    <label>From <select bind:value={fromId} onchange={evidence}><option value="">Choose source</option>{#each options as t}<option value={t.id}>{t.name}</option>{/each}</select></label>
    <label>To <select bind:value={intoId}><option value="">Choose destination</option>{#each options as t}<option value={t.id}>{t.name}</option>{/each}</select></label>
  </div>
  <div class="toolbar"><button disabled={busy||!fromId||!intoId} onclick={assess}>Assess meanings</button><button disabled={busy||!fromId||!intoId} onclick={()=>change('broader')}>Destination is broader</button><button disabled={busy||!fromId||!intoId} onclick={()=>change('related')}>Related meanings</button><button disabled={busy||!intoId||!selected.length} onclick={()=>change('reclassify')}>Reclassify selected ({selected.length})</button></div>
  {#if assessment}<p><strong>{assessment.outcome.replaceAll('_',' ')}</strong> — {assessment.rationale}</p>{#each assessment.citations as c}<blockquote>{c.quote}</blockquote>{/each}{/if}
  {#if message}<p role="status">{message}</p>{/if}
  {#each samples as s}<label class="sample"><input type="checkbox" value={s.id} bind:group={selected}/><span><strong>{s.title}</strong><br/>{s.excerpt??'No summary recorded'}</span></label>{/each}
  {#if links.length}<details><summary>Recorded relationships ({links.length})</summary>{#each links as l}<p>{label(l.from_id)} → {l.relation} → {label(l.into_id)}</p>{/each}</details>{/if}
  <details><summary>Recent changes ({history.length})</summary>{#each history as h}<div class="change"><span>{h.kind} · {h.action} · {label(h.from_id)} → {label(h.into_id)} · {new Date(h.created_at).toLocaleString()}</span><button disabled={busy||!!h.undone_at} onclick={()=>change('undo',h.id)}>{h.undone_at?'Undone':'Undo'}</button></div>{/each}</details>
</section>
<style>
  section{border-top:1px solid var(--line-strong);padding:1.25rem 0;}h2{font-size:var(--fs-body-lg)}p{line-height:1.5}.toolbar{display:flex;gap:.75rem;flex-wrap:wrap;margin:.75rem 0;}label{display:flex;flex-direction:column;gap:.35rem;min-width:0}.sample{flex-direction:row;border-top:1px solid var(--line);padding:.75rem 0;line-height:1.5}.sample input{flex-shrink:0}.change{display:flex;justify-content:space-between;gap:.5rem;padding:.75rem 0;border-top:1px solid var(--line);font-size:var(--fs-label)}button,select{font:inherit;font-size:var(--fs-body);background:var(--surface-card);color:var(--text-primary);border:1px solid var(--line-strong);padding:.5rem;max-width:100%}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}summary{cursor:pointer}select{max-width:20rem}@media(max-width:600px){.toolbar label{width:100%}select{max-width:100%}}
</style>
