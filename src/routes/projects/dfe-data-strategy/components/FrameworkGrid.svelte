<script lang="ts">
  import { FRAMEWORKS_BY_TYPE } from '../lib/frameworks';
  import type { FrameworkType } from '../lib/types';

  const GROUPS: { type: FrameworkType; label: string; blurb: string }[] = [
    { type: 'uk-gov', label: 'UK government', blurb: 'How the centre frames data strategy — the standards DfE is measured against.' },
    { type: 'corporate', label: 'Corporate & industry', blurb: 'The canon DfE’s estate can borrow from — what “should already exist” in any mature data function.' },
  ];
</script>

<div class="fg">
  {#each GROUPS as g}
    <section class="grp">
      <h3 class="grp-h">{g.label}</h3>
      <p class="grp-sub">{g.blurb}</p>
      <div class="cards">
        {#each FRAMEWORKS_BY_TYPE[g.type] as f (f.id)}
          <div class="fc" class:gov={g.type === 'uk-gov'}>
            <div class="fc-head">
              <h4>{f.name}</h4>
              {#if f.sourceUrl}<a class="fc-src" href={f.sourceUrl} target="_blank" rel="noopener">↗</a>{/if}
            </div>
            <p class="fc-sum">{f.summary}</p>
            <ul class="fc-el">{#each f.keyElements as el}<li>{el}</li>{/each}</ul>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .fg { display: flex; flex-direction: column; gap: 26px; }
  .grp-h { margin: 0 0 2px; font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; color: var(--ink); }
  .grp-sub { margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.65); max-width: 70ch; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .fc { border: 1px solid rgba(28,22,17,0.12); border-top: 3px solid #b4632e; border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .fc.gov { border-top-color: var(--accent-ink); }
  .fc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .fc-head h4 { margin: 0; font-family: 'Fraunces', serif; font-size: 15.5px; font-weight: 600; color: var(--ink); }
  .fc-src { color: var(--accent-ink); text-decoration: none; font-size: 13px; }
  .fc-sum { margin: 6px 0 8px; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.76); }
  .fc-el { margin: 0; padding-left: 16px; }
  .fc-el li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.66); margin-bottom: 2px; }
</style>
