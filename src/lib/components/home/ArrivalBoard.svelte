<script lang="ts">
  import type { ArrivalInsight } from '$lib/home/presence/insights';
  let { arrivals, generatedAt }: { arrivals: ArrivalInsight[]; generatedAt: string } = $props();
  const clock = (s: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(s));
</script>
<div class="arrival-board">
  <div class="heading"><div><p class="eyebrow">01 / On the way</p><h2>Expected arrivals</h2></div><span>Checked {clock(generatedAt)} · London time</span></div>
  {#if arrivals.length}
    <div class="arrivals">
      {#each arrivals as a (a.id)}
        <article class="arrival">
          <p class="person">{a.person} <span>{a.returningHome ? 'Likely heading home' : 'Likely destination'}</span></p>
          <h3>{a.to}</h3><div class="eta">{clock(a.earliest)}–{clock(a.latest)}</div>
          <p>About {a.minutesLeft} min away · from {a.from}</p>
          <small>{a.samples} similar trips · {a.confidence} pattern · fix {clock(a.observedAt)}</small>
        </article>
      {/each}
    </div>
    <p class="method">Destinations and arrival ranges are inferred from previous journeys. No live traffic. App alerts go to existing followers, once per journey.</p>
  {:else}
    <p class="empty">No reliable arrival estimate right now.</p>
    <p class="method">Estimates appear during a journey after three comparable trips, with a fresh location and one clear destination. School runs and journeys home are learned automatically.</p>
  {/if}
</div>
<style>
  .arrival-board { background: var(--text-primary); color: var(--bg); padding: clamp(20px, 3vw, 36px); }
  .heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; border-bottom: 1px solid rgb(237 228 212 / 25%); padding-bottom: 1rem; }
  .eyebrow { color: var(--accent-on-dark); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: .1em; margin: 0 0 .4rem; }
  h2 { margin: 0; font: clamp(1.4rem, 2vw, 2rem) var(--font-display); }
  .heading > span, .method, small { color: rgb(237 228 212 / 75%); font-size: var(--fs-label); }
  .arrivals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
  .arrival { padding: 1.4rem 1.4rem 1.4rem 0; border-bottom: 1px solid rgb(237 228 212 / 25%); }
  .person { font-weight: 700; } .person span { margin-left: .6rem; font-weight: 400; color: var(--good-on-dark); font-size: var(--fs-label); }
  h3 { margin: .5rem 0; font-size: 1.15rem; }
  .eta { font-family: var(--font-display); font-size: clamp(1.6rem, 3vw, 2.7rem); color: var(--accent-ink-on-dark); }
  .empty { font-size: 1.15rem; margin: 1.5rem 0 .6rem; }
  .method { line-height: 1.6; margin-bottom: 0; max-width: 90ch; }
</style>
