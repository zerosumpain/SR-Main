<script lang="ts">
  import { page } from '$app/stores';
  import { intelForSection, isFreshIntel, type IntelSection, type IntelSlim } from '../lib/intelTargets';

  let { section, note = '' }: { section: IntelSection; note?: string } = $props();

  const all = $derived<IntelSlim[]>($page.data.intel?.items ?? []);
  const items = $derived(intelForSection(all, section).slice(0, 12));
  const fresh = $derived(items.filter((i) => isFreshIntel(i)).length);
  let open = $state(false);
  const shown = $derived(open ? items : items.slice(0, 3));

  const DIR: Record<string, string> = { reinforces: '#2f7d4f', challenges: '#b1455e', shifts: '#b4632e', informs: '#3a5fa8' };
  // display-map the publisher: the workbench never says "DfE" in its own voice
  const pub = (p: string | null | undefined) => (p === 'Department for Education' ? 'the education department' : p);
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
</script>

{#if items.length}
  <aside class="ii" class:hot={fresh > 0} aria-label="Newly arrived intelligence">
    <div class="ii-head">
      <span class="ii-lab">◉ Arriving intelligence</span>
      <span class="ii-sub">
        {fresh ? `${fresh} new item${fresh === 1 ? '' : 's'} bearing on this section` : 'the latest items bearing on this section'} · daily GOV.UK sweep{note ? ` · ${note}` : ''}
      </span>
    </div>
    <ul class="ii-list">
      {#each shown as i (i.id)}
        <li class="ii-item" class:fresh={isFreshIntel(i)}>
          <div class="ii-line">
            {#if isFreshIntel(i)}<b class="new">NEW</b>{/if}
            <a class="ii-title" href={i.url} target="_blank" rel="noopener">{i.title} ↗</a>
          </div>
          <span class="ii-meta">
            {[pub(i.publisher), i.docType, fmt(i.publishedAt)].filter(Boolean).join(' · ')}{#if i.watchLabel}
              · <span class="ii-watch">◉ {i.watchLabel}</span>{/if}
          </span>
          {#if i.summary}<p class="ii-sum">{i.summary}</p>{/if}
          {#if i.influences.length}
            <span class="ii-inf" style="--c:{DIR[i.influences[0].direction] ?? '#3a5fa8'}" title={i.influences[0].how}>
              <i>{i.influences[0].direction}</i> {i.influences[0].label}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if items.length > 3}
      <button class="ii-more" onclick={() => (open = !open)}>{open ? '− Show fewer' : `+ Show all ${items.length}`}</button>
    {/if}
  </aside>
{/if}

<style>
  .ii { margin: 14px 0 20px; border: 1px solid rgba(28, 22, 17, 0.14); border-left: 4px solid rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-round); background: rgba(255, 255, 255, 0.45); padding: 12px 15px; }
  .ii.hot { border-left-color: #8a2d3a; background: rgba(138, 45, 58, 0.04); }
  .ii-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
  .ii-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; color: #8a2d3a; }
  .ii-sub { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28, 22, 17, 0.5); }
  .ii-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
  .ii-item { border-top: 1px dashed rgba(28, 22, 17, 0.12); padding-top: 8px; }
  .ii-item:first-child { border-top: none; padding-top: 0; }
  .ii-line { display: flex; align-items: baseline; gap: 8px; }
  .new { font-family: 'JetBrains Mono', monospace; font-style: normal; font-size: 8.5px; letter-spacing: 0.08em; color: #fff; background: #8a2d3a; border-radius: var(--radius-sharp); padding: 1px 6px; flex-shrink: 0; }
  .ii-title { font-family: 'Fraunces', serif; font-size: 14.5px; font-weight: 600; color: var(--ink); text-decoration: none; line-height: 1.3; }
  .ii-title:hover { color: var(--accent-ink); }
  .ii-meta { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28, 22, 17, 0.5); }
  .ii-watch { color: #8a2d3a; }
  .ii-sum { margin: 3px 0 2px; font-size: 12px; line-height: 1.5; color: rgba(28, 22, 17, 0.72); max-width: 90ch; }
  .ii-inf { display: inline-flex; align-items: baseline; gap: 5px; font-size: 10.5px; color: var(--ink);
    border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); background: color-mix(in srgb, var(--c) 8%, transparent);
    border-radius: var(--radius-round); padding: 2px 7px; margin-top: 3px; }
  .ii-inf i { font-family: 'JetBrains Mono', monospace; font-style: normal; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--c); }
  .ii-more { margin-top: 9px; font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 4px 10px;
    border: 1px solid rgba(28, 22, 17, 0.2); background: rgba(255, 255, 255, 0.55); border-radius: var(--radius-round); color: var(--ink); cursor: pointer; }
  .ii-more:hover { background: rgba(28, 22, 17, 0.06); }
</style>
