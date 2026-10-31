<script lang="ts">
  /**
   * One person's destinations, most time first: what kind of place, how often
   * and for how long, when they usually arrive, the journey in against the
   * stay, the walking once there, the steps it is worth (an estimate: the
   * day's steps above a day at home, shared by minutes on foot), and who from
   * home is usually there too. Hours are a bar in one hue, the number beside it.
   */
  import { categoryLabel, type PersonPattern } from '$lib/home/presence/patterns';
  import { mins } from './format';

  let { person, names }: { person: PersonPattern; names: Record<string, string> } = $props();

  const rows = $derived(person.places.filter((p) => p.category !== 'home').slice(0, 15));
  const home = $derived(person.places.find((p) => p.category === 'home') ?? null);
  const peak = $derived(Math.max(1, ...rows.map((r) => r.hours)));
  const stepsAt = $derived(new Map(person.steps.byPlace.map((s) => [s.placeId, s.steps])));
  const pct = (n: number) => `${Math.round(n * 100)}%`;
</script>

{#if !rows.length}
  <p class="pp-empty">No stays away from home in this window.</p>
{:else}
  {#if home}
    <p class="pp-home">At home <strong>{Math.round(home.hours)} h</strong> of {Math.round(home.hours + person.awayHours)} h placed ({pct(person.homeShare)}); usually back by {home.arrives}.</p>
  {/if}
  <div class="pp-wrap">
    <table class="pp">
      <thead>
        <tr>
          <th scope="col">Place</th>
          <th scope="col" class="bar-h">Hours</th>
          <th scope="col">Visits</th>
          <th scope="col">Arrives</th>
          <th scope="col">Stays</th>
          <th scope="col">Way in</th>
          <th scope="col">On foot there</th>
          <th scope="col">Steps (est.)</th>
          <th scope="col">Often with</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.placeId)}
          <tr>
            <th scope="row"><span class="pl">{r.name}</span><small>{categoryLabel(r.category)}{r.isNew ? ' · new' : ''}</small></th>
            <td>
              <div class="bar-c">
                <span class="bar" style:width={`${Math.max(3, (r.hours / peak) * 100)}%`}></span>
                <span class="n">{Math.round(r.hours)}</span>
              </div>
            </td>
            <td>{r.visits}<small>{r.days} {r.days === 1 ? 'day' : 'days'} · {pct(r.weekdayShare)} wkdy</small></td>
            <td>{r.arrives}</td>
            <td>{mins(r.medianStay)}</td>
            <td>{r.medianTravelIn ? mins(r.medianTravelIn) : '—'}{#if r.medianTravelIn}<small>{pct(r.activeShare)} on foot{r.stayPerTravel != null ? ` · ${r.stayPerTravel}× stay` : ''}</small>{/if}</td>
            <td>{r.onFootPerVisit ? mins(r.onFootPerVisit) : '—'}</td>
            <td>{stepsAt.has(r.placeId) ? Math.round(stepsAt.get(r.placeId)! / r.visits).toLocaleString('en-GB') : '—'}{#if stepsAt.has(r.placeId)}<small>a visit</small>{/if}</td>
            <td>{r.with.length ? r.with.map((w) => `${names[w.subject] ?? w.subject} ${pct(w.share)}`).join(', ') : 'alone'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .pp-home {
    margin: 0 0 10px;
    font-size: var(--fs-body-sm);
  }
  .pp-wrap {
    overflow-x: auto;
  }
  .pp {
    width: 100%;
    min-width: 860px;
    border-collapse: collapse;
    font-size: var(--fs-body-sm);
    font-variant-numeric: tabular-nums;
  }
  thead th {
    text-align: left;
    font: 500 var(--fs-label-xs) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 0 8px 6px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  tbody th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 7px 8px 7px 0;
    border-bottom: 1px solid var(--line);
  }
  tbody th {
    font-weight: 600;
    max-width: 220px;
  }
  .pl {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    display: block;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    font-weight: 400;
  }
  .bar-h {
    width: 150px;
  }
  .bar-c {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    min-height: 18px;
    align-items: center;
    gap: 6px;
  }
  .bar {
    height: 10px;
    background: var(--accent);
    border-radius: 0 2px 2px 0;
  }
  .n {
    font: var(--fs-label) var(--font-mono);
  }
  .pp-empty {
    color: var(--text-muted);
  }
</style>
