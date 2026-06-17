<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import ConsiderationCard from './ConsiderationCard.svelte';

  let title = $state('');
  let statement = $state('');
  let inFlight = false; // plain guard: keeps the build queue single-file without effect loops

  const EXAMPLES = [
    'Every child should have a single consistent identifier used across education, social care and health.',
    'DfE should default to open, reusable data standards for everything that isn’t personal data.',
    'We should build one central data platform rather than rely on local authority and trust systems.',
    'No new data collection from schools without retiring an existing one (a "collect once" rule).',
    'All AI tools used in DfE decisions about children must be published on the ATRS before go-live.',
  ];

  // Auto-build queue: whenever a draft is waiting and nothing is in flight, build it.
  // Chains through multiple drafts (e.g. several added from a suggester) one at a time.
  $effect(() => {
    const pending = app.policies.find((p) => p.status === 'draft');
    if (pending && !inFlight) void runBuild(pending.id);
  });

  function addPolicy() {
    const s = statement.trim();
    if (!s) return;
    app.addPolicyDraft(title, s); // status 'draft' → queue picks it up
    title = '';
    statement = '';
  }

  async function runBuild(id: string) {
    const p = app.policies.find((x) => x.id === id);
    if (!p) return;
    inFlight = true;
    app.setPolicy(id, { status: 'analysing', error: undefined });
    let result: any = null;
    let errMsg: string | null = null;
    try {
      const res = await fetch('/projects/dfe-data-strategy/consider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: p.title, statement: p.statement }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const o = JSON.parse(line.slice(6));
            if (o.type === 'result') result = o.data;
            else if (o.type === 'error') errMsg = o.message;
          } catch { /* heartbeat */ }
        }
      }
    } catch (e: any) {
      errMsg = e?.message ?? 'request failed';
    }
    // release the queue BEFORE the final state write, so the write re-triggers the
    // effect and the next pending draft (if any) starts immediately.
    inFlight = false;
    if (result) app.setPolicy(id, { status: 'done', considerations: result, error: undefined });
    else app.setPolicy(id, { status: 'error', error: errMsg ?? 'No appraisal returned — try again.' });
  }
</script>

<div class="pb">
  <div class="composer">
    <label class="cl">
      <span>Headline policy</span>
      <input bind:value={title} placeholder="A short title (optional)" maxlength="200" />
    </label>
    <label class="cl">
      <span>What should the strategy do, and why?</span>
      <textarea bind:value={statement} rows="3" placeholder="Write a factor in plain English — e.g. “Default to open data standards for non-personal data so partners can build on our data.”" maxlength="2000"></textarea>
    </label>
    <div class="c-actions">
      <button class="add" onclick={addPolicy} disabled={!statement.trim()}>＋ Add & build considerations</button>
      <div class="examples">
        <span class="ex-lab">Try:</span>
        {#each EXAMPLES as e}<button class="ex" onclick={() => { statement = e; title = ''; }}>{e.slice(0, 46)}…</button>{/each}
      </div>
    </div>
  </div>

  {#if app.policies.length === 0}
    <p class="empty">No policies yet. Write a headline factor above — or open the <a href="/projects/dfe-data-strategy/strategies">Influence Map</a> / <a href="/projects/dfe-data-strategy/landscape">Landscape</a> and click <b>Draft policies</b> on any card. The consideration builder weighs each against the pressures, the strategy landscape, the legal stack, the sector’s voices and the Policy Engine.</p>
  {/if}

  <div class="list">
    {#each app.policies as p (p.id)}
      <article class="policy">
        <div class="p-head">
          <div class="p-title">
            <h3>{p.title}</h3>
            {#if p.title !== p.statement}<p class="p-stmt">{p.statement}</p>{/if}
          </div>
          <div class="p-controls">
            {#if p.status === 'analysing'}<span class="badge an">Analysing…</span>
            {:else if p.status === 'draft'}<span class="badge q">Queued…</span>
            {:else if p.status === 'done'}<button class="rebuild" onclick={() => app.setPolicy(p.id, { status: 'draft' })} title="Re-run the appraisal">↻</button>
            {:else if p.status === 'error'}<button class="rebuild err" onclick={() => app.setPolicy(p.id, { status: 'draft' })} title="Retry">Retry</button>
            {/if}
            <button class="del" onclick={() => app.removePolicy(p.id)} aria-label="Delete">✕</button>
          </div>
        </div>
        {#if p.status === 'error'}<p class="p-err">⚠ {p.error}</p>{/if}
        {#if (p.status === 'analysing' || p.status === 'draft') && !p.considerations}<div class="p-skel">Weighing this against the strategic material…</div>{/if}
        {#if p.considerations}<ConsiderationCard c={p.considerations} />{/if}
      </article>
    {/each}
  </div>
</div>

<style>
  .pb { display: flex; flex-direction: column; gap: 16px; }
  .composer { border: 1px solid rgba(28,22,17,0.14); border-radius: 12px; background: rgba(255,255,255,0.5); padding: 14px 16px; }
  .cl { display: block; margin-bottom: 10px; }
  .cl span { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.55); margin-bottom: 4px; }
  .cl input, .cl textarea { width: 100%; box-sizing: border-box; border: 1px solid rgba(28,22,17,0.22); border-radius: 8px; padding: 9px 11px; font-family: 'DM Sans', sans-serif; font-size: 14px; color: var(--ink); background: rgba(255,255,255,0.8); resize: vertical; }
  .c-actions { display: flex; flex-direction: column; gap: 9px; }
  .add { align-self: flex-start; font-family: 'DM Sans', sans-serif; font-size: 13.5px; font-weight: 600; color: #fff; background: #2f6155; border: none; border-radius: 9px; padding: 9px 16px; cursor: pointer; }
  .add:disabled { opacity: 0.5; cursor: default; }
  .add:not(:disabled):hover { background: #275249; }
  .examples { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .ex-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .ex { font-size: 11px; color: #2f6155; background: rgba(63,125,110,0.07); border: 1px solid rgba(63,125,110,0.25); border-radius: 6px; padding: 4px 8px; cursor: pointer; text-align: left; }
  .ex:hover { background: rgba(63,125,110,0.15); }
  .empty { font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.6); max-width: 74ch; }
  .empty a { color: #2f6f97; }
  .list { display: flex; flex-direction: column; gap: 14px; }
  .policy { border: 1px solid rgba(28,22,17,0.12); border-radius: 12px; background: rgba(255,255,255,0.38); padding: 15px 17px; }
  .p-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .p-title h3 { margin: 0; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .p-stmt { margin: 4px 0 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.66); }
  .p-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .badge.an { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; color: #9a7b1f; background: rgba(154,123,31,0.12); padding: 4px 8px; border-radius: 5px; }
  .badge.q { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; color: rgba(28,22,17,0.5); background: rgba(28,22,17,0.07); padding: 4px 8px; border-radius: 5px; }
  .rebuild { font-family: 'JetBrains Mono', monospace; font-size: 11px; border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.6); border-radius: 6px; padding: 4px 9px; cursor: pointer; color: var(--ink); }
  .rebuild.err { color: #b1455e; border-color: rgba(177,69,94,0.4); }
  .del { background: none; border: none; color: rgba(28,22,17,0.4); cursor: pointer; font-size: 13px; }
  .p-err { margin: 0 0 8px; font-size: 12px; color: #b1455e; }
  .p-skel { font-size: 12.5px; color: rgba(28,22,17,0.55); font-style: italic; padding: 8px 0; }
</style>
