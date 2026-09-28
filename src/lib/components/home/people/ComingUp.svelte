<script lang="ts">
  /**
   * Coming up: the owner's next two days of located events, each with who is
   * likely going, where from, how long it takes and when to leave. The travel
   * time says what it stands on — someone's own trips, the household's, or a
   * router's guess — because a leave-by time is only as good as that.
   * Below, the owner's calendar → person mapping (a form, owner only).
   */
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { AgendaItem, CalendarMap } from '$lib/home/presence/agenda';
  import { cap, clock, dayLabel, mins } from './format';

  let {
    items,
    calendars,
    calendarMap,
    unlocated,
    partial,
    names,
    person,
  }: {
    items: AgendaItem[];
    calendars: string[];
    calendarMap: CalendarMap;
    unlocated: number;
    partial: boolean;
    names: Map<string, string>;
    person: string | null;
  } = $props();

  const nameOf = (s: string) => names.get(s) ?? cap(s);
  const shown = $derived(person ? items.filter((i) => i.subjects.includes(person)) : items);
  const localDate = (t: string) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const today = localDate(new Date().toISOString());
  const dayOf = (t: string) => (localDate(t) === today ? 'Today' : dayLabel(t));
  const groups = $derived.by(() => {
    const out: Array<{ day: string; items: AgendaItem[] }> = [];
    for (const i of shown) {
      const d = dayOf(i.start);
      if (out.at(-1)?.day === d) out.at(-1)!.items.push(i);
      else out.push({ day: d, items: [i] });
    }
    return out;
  });
  const basis = (i: AgendaItem) => {
    const t = i.travel;
    if (!t) return null;
    if (t.source === 'person') return `${mins(t.median)} · from ${t.samples} of ${nameOf(i.subjects[0])}’s trips`;
    if (t.source === 'household') return `${mins(t.median)} · from ${t.basis}’s trips`;
    return `${mins(t.median)} ${t.mode === 'vehicle' ? 'by car' : 'on foot'} · routed, nobody has made this trip yet`;
  };
  const WHY = { previous: 'after the last thing', now: 'from where they are', home: 'from home' } as const;
  const selected = (c: string) => {
    const v = calendarMap[c];
    return v == null ? 'auto' : v.length ? v.join(',') : 'nobody';
  };
  let saved = $state(false);
</script>

{#if !shown.length}
  <p class="cu-quiet">
    {person ? `Nothing with a location for ${nameOf(person)} in the next two days.` : 'Nothing with a location in the next two days.'}
    {#if unlocated}{unlocated} {unlocated === 1 ? 'event has' : 'events have'} no location, so no journey is planned for {unlocated === 1 ? 'it' : 'them'}.{/if}
  </p>
{:else}
  {#each groups as g (g.day)}
    <h3 class="cu-day">{g.day}</h3>
    <ul class="cu">
      {#each g.items as i (i.id)}
        <li data-issue={i.issue?.kind ?? undefined}>
          <span class="cu-time">{clock(i.start)}</span>
          <div class="cu-what">
            <strong>{i.title}</strong>
            <small>
              {i.subjects.map(nameOf).join(', ')}{i.assignedBy === 'owner' ? ' (no one named — yours by default)' : ''}
              · {i.place?.label ?? i.location}{i.origin ? ` · ${WHY[i.origin.why]}` : ''}
            </small>
            {#if basis(i)}<small>{basis(i)}</small>{/if}
            {#if i.issue}<small class="cu-issue">{i.issue.text}</small>{/if}
          </div>
          <div class="cu-leave">
            {#if i.leaveBy}
              <strong>{clock(i.leaveBy)}</strong>
              <small>leave by</small>
            {:else if i.place}
              <small>{i.origin?.id === i.place.id ? 'already there' : 'timing…'}</small>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/each}
  {#if unlocated || partial}
    <p class="cu-quiet">
      {#if unlocated}{unlocated} more {unlocated === 1 ? 'event has' : 'events have'} no location.{/if}
      {#if partial}Some calendars could not be read; this list may be incomplete.{/if}
    </p>
  {/if}
{/if}

{#if calendars.length}
  <details class="cu-map">
    <summary>Who travels for each calendar</summary>
    <form
      method="POST"
      action="?/calendars"
      use:enhance={() => async ({ result }) => {
        if (result.type === 'success') {
          saved = true;
          await invalidateAll();
        }
      }}
    >
      <p>By default an event goes to anyone named in its title, else to you. Set a calendar to one person, or to nobody for calendars that never mean a journey.</p>
      {#each calendars as c (c)}
        <label>
          <span>{c}</span>
          <select name={`cal:${c}`} value={selected(c)}>
            <option value="auto">Names in the title, else you</option>
            <option value="nobody">Nobody travels</option>
            {#each [...names] as [subject, name] (subject)}
              <option value={subject}>{name}</option>
            {/each}
          </select>
        </label>
      {/each}
      <button type="submit">Save</button>
      {#if saved}<span class="cu-saved" role="status">Saved</span>{/if}
    </form>
  </details>
{/if}

<style>
  .cu-day {
    margin: 14px 0 2px;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .cu {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) auto;
    gap: 2px 12px;
    align-items: baseline;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  li[data-issue='tight'],
  li[data-issue='overlap'] {
    box-shadow: inset 3px 0 0 var(--accent);
    padding-left: 8px;
  }
  .cu-time {
    font: 600 var(--fs-label) var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .cu-what strong {
    font-size: var(--fs-nav);
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .cu-issue {
    color: var(--accent);
    font-weight: 600;
  }
  .cu-leave {
    text-align: right;
  }
  .cu-leave strong {
    font: var(--fs-body-lg) var(--font-display);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .cu-quiet {
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
  }
  .cu-map {
    margin-top: 14px;
    font-size: var(--fs-body-sm);
  }
  summary {
    cursor: pointer;
    font: 600 var(--fs-label) var(--font-mono);
    color: var(--accent-ink);
  }
  .cu-map form {
    display: grid;
    gap: 8px;
    padding-top: 8px;
  }
  .cu-map p {
    margin: 0;
    color: var(--text-muted);
  }
  label {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 8px;
    align-items: center;
  }
  select {
    font: var(--fs-body) var(--font-body);
    padding: 4px 6px;
    background: var(--surface-card);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  button {
    justify-self: start;
    font: 600 var(--fs-label) var(--font-mono);
    padding: 6px 12px;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--bg);
    border-radius: 2px;
    cursor: pointer;
  }
  .cu-saved {
    font: 600 var(--fs-label-xs) var(--font-mono);
    color: var(--good);
  }
</style>
