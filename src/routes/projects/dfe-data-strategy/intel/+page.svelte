<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const items = $derived(data.snapshot?.items ?? []);
  const lastRun = $derived(data.snapshot?.lastRun ?? null);

  let sweeping = $state(false);
  let note = $state('');
  async function runSweep() {
    if (sweeping) return;
    sweeping = true; note = 'Sweeping GOV.UK and classifying against the strategy… (~1 min)';
    try {
      const res = await fetch('/api/dfe-data-strategy/intel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) });
      if (res.ok) { note = 'Done — reloading…'; location.reload(); }
      else { note = 'Sweep is running server-side; refresh in a minute.'; }
    } catch {
      note = 'Sweep is running server-side; refresh in a minute.';
    } finally {
      sweeping = false;
    }
  }

  const DIR: Record<string, { label: string; color: string }> = {
    reinforces: { label: 'reinforces', color: '#2f7d4f' },
    challenges: { label: 'challenges', color: '#b1455e' },
    shifts: { label: 'shifts', color: '#b4632e' },
    informs: { label: 'informs', color: '#3a5fa8' },
  };
  const sevCol: Record<string, string> = { high: '#b1455e', medium: '#b4632e', low: '#9a7b1f' };
  const href = (i: { kind: string }) => (i.kind === 'strategy' ? '/projects/dfe-data-strategy/strategies' : '/projects/dfe-data-strategy/landscape');
  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
</script>

<svelte:head>
  <title>Intelligence radar — Keystone</title>
  <meta name="description" content="A daily sweep of new UK-government publications, news and policy — classified for how each bears on the DfE data strategy, with the considerations and misalignments it raises." />
</svelte:head>

<div class="pe-route ir">
  <span class="pe-eyebrow">Live · Intelligence radar</span>
  <h1 class="pe-h1">What just landed — and what it means for the strategy</h1>
  <p class="pe-lede intro">
    A daily sweep reads new UK-government publications, news and policy, then weighs each against this strategy: <b>how</b> it influences which strategies and pressures, the <b>considerations</b> it raises, and any <b>misalignments</b> with the current direction. Intelligence, scored for relevance — not a feed to scroll.
  </p>

  <div class="bar">
    <span class="stamp">
      {#if lastRun}
        Last sweep {fmtDate(lastRun.runAt)} · {lastRun.itemsFound} scanned · {lastRun.classified} classified{#if !lastRun.ok} · ⚠ source error{/if}
      {:else}
        No sweep has run yet.
      {/if}
    </span>
    {#if data.authed}
      <button class="sweep" onclick={runSweep} disabled={sweeping}>{sweeping ? 'Sweeping…' : '↻ Run sweep now'}</button>
    {/if}
  </div>
  {#if note}<p class="note">{note}</p>{/if}

  {#if items.length === 0}
    <div class="empty">
      <p>No classified intelligence yet. The radar sweeps daily at 06:40 UTC{#if data.authed} — or run it now with the button above{/if}. New items are read against the strategy and surfaced here when they’re relevant.</p>
    </div>
  {:else}
    <div class="feed">
      {#each items as it (it.id)}
        <article class="card">
          <div class="c-head">
            <span class="rel" title="Relevance to the strategy" style="--n:{it.relevance}">{'●'.repeat(it.relevance)}<span class="ghost">{'●'.repeat(5 - it.relevance)}</span></span>
            <a class="c-title" href={it.url} target="_blank" rel="noopener">{it.title}</a>
          </div>
          <div class="c-meta">{[it.publisher, it.docType, fmtDate(it.publishedAt)].filter(Boolean).join(' · ')}</div>
          {#if it.summary}<p class="c-sum">{it.summary}</p>{/if}

          {#if it.influences.length}
            <div class="sec">
              <span class="sec-l">Influences</span>
              <div class="chips">
                {#each it.influences as inf}
                  <a class="inf" href={href(inf)} style="--c:{DIR[inf.direction]?.color ?? '#3a5fa8'}" title={inf.how}>
                    <i>{DIR[inf.direction]?.label ?? inf.direction}</i> {inf.label}
                  </a>
                {/each}
              </div>
            </div>
          {/if}

          {#if it.misalignments.length}
            <div class="sec">
              <span class="sec-l warn">Possible misalignment</span>
              {#each it.misalignments as m}
                <div class="mis" style="--c:{sevCol[m.severity] ?? '#b4632e'}"><span class="m-sev">{m.severity}</span>{m.point}</div>
              {/each}
            </div>
          {/if}

          {#if it.considerations.length}
            <div class="sec">
              <span class="sec-l">Considerations</span>
              <ul class="cons">{#each it.considerations as c}<li>{c}</li>{/each}</ul>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}

  <p class="foot-link">Weigh any of this in the <a href="/projects/dfe-data-strategy/policy-builder">Policy Builder</a>, or see the full <a href="/projects/dfe-data-strategy/strategies">influence map</a>.</p>
</div>

<style>
  .ir { max-width: 1000px; }
  .intro { max-width: 78ch; margin-bottom: 14px; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid rgba(28,22,17,0.12); border-bottom: 1px solid rgba(28,22,17,0.12); }
  .stamp { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: rgba(28,22,17,0.6); }
  .sweep { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 6px 11px; border: 1px solid rgba(28,22,17,0.25); background: rgba(255,255,255,0.6); border-radius: 7px; cursor: pointer; color: var(--ink); }
  .sweep:disabled { opacity: 0.6; }
  .note { margin: 8px 0 0; font-size: 12px; color: #2f6155; }
  .empty { margin: 20px 0; padding: 18px; border: 1px dashed rgba(28,22,17,0.2); border-radius: 12px; background: rgba(255,255,255,0.3); }
  .empty p { margin: 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.65); max-width: 72ch; }
  .feed { display: flex; flex-direction: column; gap: 12px; margin: 16px 0; }
  .card { border: 1px solid rgba(28,22,17,0.12); border-radius: 12px; background: rgba(255,255,255,0.42); padding: 14px 16px; }
  .c-head { display: flex; align-items: baseline; gap: 9px; }
  .rel { font-size: 8px; color: #2f7d4f; letter-spacing: 1px; white-space: nowrap; flex-shrink: 0; }
  .rel .ghost { color: rgba(28,22,17,0.15); }
  .c-title { font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--ink); text-decoration: none; line-height: 1.25; }
  .c-title:hover { color: #2f6f97; }
  .c-meta { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.5); margin: 4px 0 0; }
  .c-sum { margin: 8px 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.78); }
  .sec { margin-top: 9px; }
  .sec-l { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.07em; color: rgba(28,22,17,0.5); margin-bottom: 5px; }
  .sec-l.warn { color: #b1455e; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .inf { display: inline-flex; align-items: baseline; gap: 5px; font-size: 11px; color: var(--ink); text-decoration: none; border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); background: color-mix(in srgb, var(--c) 8%, transparent); border-radius: 6px; padding: 3px 8px; }
  .inf:hover { background: color-mix(in srgb, var(--c) 16%, transparent); }
  .inf i { font-family: 'JetBrains Mono', monospace; font-style: normal; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--c); }
  .mis { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.8); border-left: 3px solid var(--c); padding-left: 8px; margin-bottom: 5px; }
  .m-sev { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; color: #fff; background: var(--c); padding: 1px 5px; border-radius: 3px; margin-right: 6px; }
  .cons { margin: 0; padding-left: 16px; }
  .cons li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); margin-bottom: 3px; }
  .foot-link { margin: 22px 0 0; font-size: 13px; color: rgba(28,22,17,0.65); }
  .foot-link a { color: #2f6f97; }
</style>
