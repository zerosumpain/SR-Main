<script lang="ts">
  /**
   * Steps against movement. Everyone on one scale: a day at home (hollow) and
   * a day out (filled), the gap between them drawn. Then, for the person in
   * focus, the kinds of place whose days carry the most steps (days there
   * against the days not, holidays kept out of the comparison), their week
   * by weekday, and how steps track time out on foot. The pilot keeps one
   * count a day, so every figure is a day's, never an hour's.
   */
  import { categoryLabel, type PersonPattern } from '$lib/home/presence/patterns';

  let { people, focus }: { people: PersonPattern[]; focus: PersonPattern | null } = $props();

  const counted = $derived(people.filter((p) => p.steps.days > 0));
  const max = $derived(Math.ceil(Math.max(5000, ...counted.flatMap((p) => [p.steps.homeDay ?? 0, p.steps.outDay ?? 0, p.steps.mean ?? 0])) / 2500) * 2500);
  const x = (v: number) => `${(v / max) * 100}%`;
  const ticks = $derived(Array.from({ length: max / 2500 + 1 }, (_, i) => i * 2500).filter((t, i, a) => a.length <= 7 || i % 2 === 0));
  const n = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-GB'));
  const lifts = $derived(focus?.steps.byCategory ?? []);
  const liftMax = $derived(Math.max(1, ...lifts.map((l) => Math.abs(l.lift))));
  const weekMax = $derived(Math.max(1, ...(focus?.steps.week ?? []).map((w) => w.mean)));
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

{#if !counted.length}
  <p class="st-empty">No step counts from the app in this window.</p>
{:else}
  <ul class="st-legend" aria-label="Legend">
    <li><span class="dot hollow"></span>Day at home</li>
    <li><span class="dot"></span>Day out</li>
  </ul>
  <div class="st-rows">
    {#each counted as p (p.subject)}
      <div class="st-row" class:lit={focus?.subject === p.subject}>
        <span class="st-name">{p.displayName}</span>
        <div class="st-track" title={`${p.displayName}: ${n(p.steps.homeDay)} on a day at home, ${n(p.steps.outDay)} on a day out; ${n(p.steps.mean)} a day over ${p.steps.days} days`}>
          {#if p.steps.homeDay != null && p.steps.outDay != null}
            <span class="gap" style:left={x(Math.min(p.steps.homeDay, p.steps.outDay))} style:width={x(Math.abs(p.steps.outDay - p.steps.homeDay))}></span>
          {/if}
          {#if p.steps.homeDay != null}<span class="dot hollow" style:left={x(p.steps.homeDay)}></span>{/if}
          {#if p.steps.outDay != null}<span class="dot" style:left={x(p.steps.outDay)}></span>{/if}
        </div>
        <span class="st-num">{n(p.steps.homeDay)} → {n(p.steps.outDay)}</span>
      </div>
    {/each}
    <div class="st-row st-axis" aria-hidden="true">
      <span></span>
      <div class="st-ticks">{#each ticks as t (t)}<span style:left={x(t)}>{t ? `${t / 1000}k` : '0'}</span>{/each}</div>
      <span></span>
    </div>
  </div>

  {#if focus}
    <div class="st-focus">
      <div>
        <h3>{focus.displayName}: the days that walk</h3>
        {#if lifts.length}
          <ul class="lift">
            {#each lifts as l (l.category)}
              <li title={`${categoryLabel(l.category)}: ${n(l.withMean)} a day over ${l.days} days, against ${n(l.withoutMean)} on the others`}>
                <span class="lift-k">{categoryLabel(l.category)}<small>{l.days} days</small></span>
                <span class="lift-bar"><span class:neg={l.lift < 0} style:width={`${(Math.abs(l.lift) / liftMax) * 100}%`}></span></span>
                <span class="lift-n">{l.lift > 0 ? '+' : ''}{n(l.lift)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="st-empty">Not enough step days at any kind of place yet (four on each side).</p>
        {/if}
        {#if focus.steps.perOnFootHour != null}
          <p class="strap">Each hour out on foot comes with about <strong>{n(focus.steps.perOnFootHour)}</strong> more steps that day (r = {focus.steps.r}, {focus.observedDays} well-seen days{focus.steps.r != null && Math.abs(focus.steps.r) < 0.3 ? '; a loose fit — much of their walking is indoors or untracked' : ''}).</p>
        {/if}
      </div>
      <div>
        <h3>By weekday</h3>
        <div class="wk" role="img" aria-label={`${focus.displayName}'s mean steps by weekday`}>
          {#each focus.steps.week as w (w.weekday)}
            <div class="wk-col" title={`${DAYS[w.weekday]}: ${n(w.mean)} steps on average`}>
              <span class="wk-n">{w.mean ? `${(w.mean / 1000).toFixed(1)}k` : ''}</span>
              <span class="wk-plot"><span class="wk-bar" style:height={`${(w.mean / weekMax) * 100}%`}></span></span>
              <span class="wk-d">{DAYS[w.weekday]}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .st-legend {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    gap: 16px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .st-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .st-legend .dot {
    position: static;
    transform: none;
  }
  .st-rows {
    display: grid;
    gap: 6px;
  }
  .st-row {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 120px;
    gap: 10px;
    align-items: center;
  }
  .st-name {
    font: var(--fs-label) var(--font-mono);
  }
  .st-row.lit .st-name {
    color: var(--accent);
    font-weight: 700;
  }
  .st-track {
    position: relative;
    height: 22px;
    border-bottom: 1px solid var(--line);
  }
  .gap {
    position: absolute;
    top: 10px;
    height: 2px;
    background: var(--text-muted);
  }
  .dot {
    position: absolute;
    top: 11px;
    width: 10px;
    height: 10px;
    border-radius: 100px;
    background: var(--accent);
    border: 2px solid var(--accent);
    transform: translate(-50%, -50%);
    display: inline-block;
  }
  .dot.hollow {
    background: var(--surface-card);
  }
  .st-num {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .st-ticks {
    position: relative;
    height: 14px;
  }
  .st-ticks span {
    position: absolute;
    transform: translateX(-50%);
    font: 12px var(--font-mono);
    color: var(--text-muted);
  }
  .st-focus {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 24px;
    margin-top: 18px;
  }
  @media (max-width: 700px) {
    .st-focus {
      grid-template-columns: minmax(0, 1fr);
    }
    .st-row {
      grid-template-columns: 56px minmax(0, 1fr) 96px;
    }
  }
  h3 {
    margin: 0 0 8px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .lift {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .lift li {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr) 64px;
    gap: 8px;
    align-items: center;
  }
  .lift-k {
    font-size: var(--fs-body-sm);
  }
  .lift-k small {
    display: block;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .lift-bar {
    height: 10px;
  }
  .lift-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 0 2px 2px 0;
  }
  .lift-bar span.neg {
    background: var(--text-ghost);
  }
  .lift-n {
    font: var(--fs-label) var(--font-mono);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .wk {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .wk-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .wk-plot {
    height: 100px;
    width: 70%;
    display: flex;
    align-items: flex-end;
    border-bottom: 1px solid var(--line);
  }
  .wk-bar {
    width: 100%;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
  }
  .wk-n,
  .wk-d {
    font: 12px var(--font-mono);
    color: var(--text-muted);
  }
  .strap {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .st-empty {
    color: var(--text-muted);
  }
</style>
