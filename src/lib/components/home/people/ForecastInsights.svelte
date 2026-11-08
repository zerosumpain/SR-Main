<script lang="ts">
  /**
   * What changed, where next, and a week of health — the forecast's reading
   * of the people a viewer may see. Drawn on the owner's Forecast page and,
   * for a member, on /home/people; both loads scope what they pass in (a
   * member's health is their own and no one else's, not even a ward's).
   */
  import type { Change } from '$lib/home/presence/changes';
  import type { PlaceOdds } from '$lib/home/presence/forecast';
  import type { WeekHealth } from '$lib/home/presence/health-week';
  import { cap, dayLabel } from './format';

  let {
    changes,
    odds,
    health,
    names,
    isOwner,
    digestAt,
    top1 = null,
  }: {
    changes: Change[];
    odds: PlaceOdds[];
    health: Array<WeekHealth & { subject: string }>;
    names: Record<string, string>;
    isOwner: boolean;
    digestAt: string | null;
    /** How often the top pick was right when scored, if known. */
    top1?: number | null;
  } = $props();

  const nameOf = (s: string) => names[s] ?? cap(s);
  const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
  const hours = (h: number | null) => (h == null ? '—' : `${Math.floor(h)} h ${Math.round((h % 1) * 60)} m`);
</script>

    <section class="card" aria-labelledby="changes-h">
      <p class="kicker">What changed</p>
      <h2 id="changes-h">This fortnight against the weeks before</h2>
      <p class="strap">Leaving earlier or later, journeys getting slower, routines starting or stopping, more walking or more driving. Never compared across a change of tracker{digestAt ? `; read ${dayLabel(digestAt)}` : ''}.</p>
      {#if changes.length}
        <ul class="rows changes">
          {#each changes as c (c.key)}
            <li><strong>{c.title}</strong><small>{c.detail}</small></li>
          {/each}
        </ul>
      {:else}
        <p class="strap quiet">{digestAt ? 'Nothing has changed enough to say.' : 'Built nightly; the first read comes at 2am.'}</p>
      {/if}
</section>

<section class="card" aria-labelledby="odds-h">
      <p class="kicker">Where next</p>
      <h2 id="odds-h">For anyone at a known place now</h2>
      <p class="strap">Their own departures from here at about this time of day, newer trips counting more. {top1 != null ? `Top pick right ${pct(top1)} of the time when scored.` : ''}</p>
      {#if odds.length}
        <ul class="rows">
          {#each odds as o (o.subject)}
            <li class="odds">
              <span><strong>{nameOf(o.subject)}</strong> at {o.from}</span>
              <span class="bars">
                {#each o.options as opt (opt.toId)}
                  <span class="opt" title={`${opt.to}: ${Math.round(opt.share * 100)}% of ${o.samples} departures, usually about ${opt.usual}`}>
                    <i style={`width:${Math.max(4, opt.share * 100)}%`}></i>{opt.to} {Math.round(opt.share * 100)}%
                  </span>
                {/each}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="strap quiet">Nobody is at a place with enough departures at this time of day to say.</p>
      {/if}
</section>

<section class="card" aria-labelledby="health-h">
      <p class="kicker">Health</p>
      <h2 id="health-h">{isOwner ? 'Everyone’s week, from the app' : 'Your week, from the app'}</h2>
      <p class="strap">{isOwner ? 'What each person chose to upload from Apple Health over the last seven days. You see everyone’s; each person sees only their own.' : 'What you chose to upload from Apple Health over the last seven days. Only you and the owner see it.'}</p>
      {#if health.length}
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Who</th><th class="right">Steps a day</th><th class="right">Sleep a night</th><th class="right">Workouts</th></tr></thead>
            <tbody>
              {#each health as h (h.subject)}
                <tr>
                  <td class="lead">{nameOf(h.subject)}</td>
                  <td class="right num">{h.steps == null ? '—' : h.steps.toLocaleString('en-GB')}<small>{h.stepDays} days</small></td>
                  <td class="right num">{hours(h.sleepHours)}<small>{h.nights} nights</small></td>
                  <td class="right num">{h.workouts}<small>{h.workoutMinutes} min</small></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="strap quiet">{digestAt ? 'No health uploaded from the app this week.' : 'Built nightly; the first read comes at 2am.'}</p>
      {/if}
</section>


<style>
  .card {
    padding: 22px clamp(16px, 2.4vw, 32px) 26px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  @media (max-width: 900px) {
    .card {
      border-right: 0;
    }
  }
  .kicker {
    margin: 0 0 4px;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h2 {
    margin: 0 0 6px;
    font: var(--fs-display-xs) var(--font-display);
    text-wrap: balance;
  }
  .strap {
    margin: 0 0 14px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 75ch;
  }
  .quiet {
    font-style: italic;
  }
  small {
    display: block;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .rows li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .changes li {
    display: block;
  }
  .odds {
    align-items: center;
  }
  .bars {
    display: grid;
    gap: 4px;
    min-width: min(100%, 260px);
    flex: 1;
  }
  .opt {
    position: relative;
    isolation: isolate;
    font: var(--fs-label-xs) var(--font-mono);
    padding: 2px 6px;
    color: var(--text-primary);
  }
  .opt i {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgb(from var(--accent-ink) r g b / 16%);
    border-radius: 2px;
    z-index: -1;
  }
  .num small {
    font-size: var(--fs-label-xs);
  }
</style>
