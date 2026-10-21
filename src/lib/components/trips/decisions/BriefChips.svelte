<script lang="ts">
  /**
   * The brief: what the planner knows about the trip, one chip per fact, each
   * labelled with where it came from — You said, From your notes, Found, or
   * Assumed. An assumption is inked in the accent with Right / Change, so a
   * guess is never passed off as a fact. Tapping a chip opens it under the
   * row: the detail, the note it came from, and — for dates, place, who, pace,
   * getting about and stays — an editor that changes it directly (PATCH
   * brief), no chat needed. Anything else is handed to the planner.
   */
  import { tick } from 'svelte';
  import type { BriefItem, BriefPatch, TripBrief } from '$lib/trips/decisions';
  import { briefChip } from '$lib/trips/decisions-view';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import type { Stay, TravelMode } from '$lib/trips/model';

  type Traveller = { name: string; age: number | null; personId: string | null };

  let {
    brief,
    trip,
    stays,
    travellers,
    family = [],
    desk,
  }: {
    brief: TripBrief;
    trip: { startDate: string; endDate: string; destination: string; pace: 'relaxed' | 'normal' | 'packed'; modes: TravelMode[] };
    stays: Stay[];
    travellers: Traveller[];
    /** The family roster's names, for adding someone with a tap. */
    family?: Array<{ id: string; name: string }>;
    desk: DecisionDesk;
  } = $props();

  const MODES: Array<{ m: TravelMode; label: string }> = [
    { m: 'walk', label: 'Walking' },
    { m: 'transit', label: 'Public transport' },
    { m: 'taxi', label: 'Taxi' },
    { m: 'drive', label: 'Driving' },
    { m: 'cycle', label: 'Cycling' },
  ];
  const PACES = [
    { v: 'relaxed', label: 'Relaxed', line: '9:30 to 18:30, room to wander' },
    { v: 'normal', label: 'Normal', line: '9:00 to 19:00' },
    { v: 'packed', label: 'Packed', line: '8:00 to 21:00, with dinner out' },
  ] as const;

  // The open chip, by key; its editor's working copy is filled when it opens (never in an effect).
  let openKey = $state<string | null>(null);
  let f = $state({
    startDate: '',
    endDate: '',
    destination: '',
    pace: 'normal' as 'relaxed' | 'normal' | 'packed',
    modes: [] as TravelMode[],
    people: [] as Traveller[],
    stayName: '',
    stayPlace: '',
    stayFrom: '',
    stayTo: '',
  });
  const open = $derived(brief.items.find((i) => i.key === openKey) ?? null);
  const view = $derived(open ? briefChip(open) : null);
  let panel = $state<HTMLElement | null>(null);

  function show(item: BriefItem, edit = false) {
    if (openKey === item.key && !edit) {
      close(item.key);
      return;
    }
    const stay = item.kind === 'stay' ? stays.find((s) => `stay:${s.id}` === item.key) : undefined;
    f = {
      startDate: trip.startDate,
      endDate: trip.endDate,
      destination: trip.destination,
      pace: trip.pace,
      modes: [...trip.modes],
      people: travellers.map((t) => ({ ...t })),
      stayName: stay?.name ?? '',
      stayPlace: stay?.address ?? stay?.name ?? '',
      stayFrom: stay?.fromDate ?? trip.startDate,
      stayTo: stay?.toDate ?? trip.endDate,
    };
    openKey = item.key;
    void tick().then(() => (panel?.querySelector('input, select, button.dx-btn') as HTMLElement | null)?.focus());
  }
  function close(key = openKey) {
    openKey = null;
    if (key) void tick().then(() => document.getElementById(`bc-${cssId(key)}`)?.focus());
  }
  const cssId = (k: string) => k.replace(/[^a-z0-9-]/gi, '-');

  function patchFor(item: BriefItem): BriefPatch | null {
    switch (view?.editor) {
      case 'dates':
        return f.startDate && f.endDate && f.endDate >= f.startDate ? { field: 'dates', startDate: f.startDate, endDate: f.endDate } : null;
      case 'destination':
        return f.destination.trim() ? { field: 'destination', destination: f.destination.trim() } : null;
      case 'pace':
        return { field: 'pace', pace: f.pace };
      case 'modes':
        return { field: 'modes', modes: f.modes.includes('walk') ? f.modes : ['walk', ...f.modes] };
      case 'travellers': {
        const people = f.people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), age: p.age ?? null, personId: p.personId ?? null }));
        return people.length ? { field: 'travellers', travellers: people } : null;
      }
      case 'stay': {
        const id = item.key.startsWith('stay:') ? item.key.slice(5) : null;
        return f.stayName.trim() && f.stayFrom && f.stayTo ? { field: 'stay', id, name: f.stayName.trim(), placeQuery: f.stayPlace.trim() || f.stayName.trim(), fromDate: f.stayFrom, toDate: f.stayTo } : null;
      }
      default:
        return null;
    }
  }
  let invalid = $state<string | null>(null);
  async function save(item: BriefItem) {
    const patch = patchFor(item);
    if (!patch) {
      invalid = view?.editor === 'dates' ? 'The last day must be on or after the first.' : 'Fill that in first.';
      return;
    }
    invalid = null;
    if (await desk.patchBrief(patch, `Changed: ${item.label}`)) close(item.key);
  }
  async function confirm(item: BriefItem) {
    if (await desk.patchBrief({ field: 'confirm', key: item.key }, `Confirmed: ${item.label}`)) close(item.key);
  }
  async function remove(item: BriefItem) {
    if (await desk.patchBrief({ field: 'remove', key: item.key }, `Taken off the brief: ${item.label}`)) close(item.key);
  }
  function toggleMode(m: TravelMode) {
    if (m === 'walk') return;
    f.modes = f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m];
  }
  function addPerson(p: Traveller = { name: '', age: null, personId: null }) {
    f.people = [...f.people, p];
    if (!p.name) void tick().then(() => (panel?.querySelector(`#bt-name-${f.people.length - 1}`) as HTMLInputElement | null)?.focus());
  }
  const unlisted = $derived(family.filter((m) => !f.people.some((p) => p.personId === m.id || p.name.trim().toLowerCase() === m.name.toLowerCase())));
</script>

<div class="bc">
  <ul class="bc-row" role="list" aria-label="What the planner knows">
    {#each brief.items as item (item.key)}
      {@const v = briefChip(item)}
      <li class="bc-item" class:assumed={v.assumed}>
        <button
          id="bc-{cssId(item.key)}"
          class="bc-chip dx-chip-btn"
          type="button"
          aria-expanded={openKey === item.key}
          aria-controls="bc-panel"
          onclick={() => show(item)}
        >
          <span class="bc-label">{item.label}</span>
          <span class="bc-origin">{v.originLabel}</span>
        </button>
        {#if v.assumed}
          <span class="bc-quick">
            <button class="dx-link" type="button" disabled={!!desk.busy} onclick={() => confirm(item)} aria-label="Right: {item.label}">Right</button>
            <button class="dx-link" type="button" onclick={() => show(item, true)} aria-label="Change: {item.label}">Change</button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if brief.missing.length}
    <p class="dx-aside bc-missing">Still to find out, assumed meanwhile: {brief.missing.join('; ')}.</p>
  {/if}

  {#if open && view}
    <section id="bc-panel" class="bc-panel np-card np-card--plain" aria-label="{open.label}, {view.originLabel}" bind:this={panel}>
      <header class="bc-hd">
        <p class="dx-k">{view.originLabel}</p>
        <h3 class="bc-h">{open.label}</h3>
        <button class="dx-link bc-x" type="button" onclick={() => close()}>Close</button>
      </header>
      {#if open.detail}<p class="bc-detail">{open.detail}</p>{/if}
      {#if open.note}<p class="dx-aside">{open.note}{#if open.ref && /^https?:/.test(open.ref)}{' · '}<a href={open.ref} target="_blank" rel="noopener noreferrer">see it</a>{/if}</p>{/if}

      {#if view.editor}
        <form class="bc-form" onsubmit={(e) => { e.preventDefault(); void save(open); }}>
          {#if view.editor === 'dates'}
            <label>First day <input class="bc-field" type="date" bind:value={f.startDate} required /></label>
            <label>Last day <input class="bc-field" type="date" bind:value={f.endDate} min={f.startDate} required /></label>
          {:else if view.editor === 'destination'}
            <label class="wide">Where <input class="bc-field" bind:value={f.destination} required placeholder="Rome, Italy" /></label>
          {:else if view.editor === 'pace'}
            <fieldset class="bc-set">
              <legend>Pace</legend>
              {#each PACES as pc (pc.v)}
                <label class="bc-radio"><input type="radio" name="bc-pace" value={pc.v} bind:group={f.pace} /> <strong>{pc.label}</strong> <span class="dx-aside">{pc.line}</span></label>
              {/each}
            </fieldset>
          {:else if view.editor === 'modes'}
            <fieldset class="bc-set">
              <legend>Getting about</legend>
              {#each MODES as md (md.m)}
                <label class="bc-radio"><input type="checkbox" checked={md.m === 'walk' || f.modes.includes(md.m)} disabled={md.m === 'walk'} onchange={() => toggleMode(md.m)} /> {md.label}</label>
              {/each}
            </fieldset>
          {:else if view.editor === 'travellers'}
            <fieldset class="bc-set">
              <legend>Who is going</legend>
              {#each f.people as p, pi (pi)}
                <div class="bc-person">
                  <label>Name <input id="bt-name-{pi}" class="bc-field" bind:value={p.name} /></label>
                  <label>Age <input class="bc-field age" type="number" min="0" max="120" inputmode="numeric" value={p.age ?? ''} oninput={(e) => (p.age = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} /></label>
                  <button class="dx-link danger" type="button" onclick={() => (f.people = f.people.filter((_, i) => i !== pi))} aria-label="Remove {p.name || 'this traveller'}">Remove</button>
                </div>
              {/each}
              <div class="bc-add">
                <button class="dx-pen" type="button" onclick={() => addPerson()}>+ Someone else</button>
                {#each unlisted as m (m.id)}<button class="dx-pen" type="button" onclick={() => addPerson({ name: m.name, age: null, personId: m.id })}>+ {m.name}</button>{/each}
              </div>
            </fieldset>
          {:else if view.editor === 'stay'}
            <label>Name <input class="bc-field" bind:value={f.stayName} required placeholder="The flat" /></label>
            <label class="wide">Address or area <input class="bc-field" bind:value={f.stayPlace} placeholder="Via del Governo Vecchio 69, Rome" /></label>
            <label>First night <input class="bc-field" type="date" bind:value={f.stayFrom} required /></label>
            <label>Leave on <input class="bc-field" type="date" bind:value={f.stayTo} min={f.stayFrom} required /></label>
          {/if}
          <div class="bc-go">
            <button class="dx-btn small" type="submit" disabled={!!desk.busy}>{desk.busy === 'brief' ? 'Saving…' : 'Save'}</button>
            {#if view.canConfirm}<button class="dx-btn small ghost" type="button" disabled={!!desk.busy} onclick={() => confirm(open)}>It’s right as it is</button>{/if}
            <button class="dx-link" type="button" onclick={() => close()}>Cancel</button>
          </div>
          {#if invalid}<p class="dx-err" role="alert">{invalid}</p>{/if}
        </form>
      {:else}
        <div class="bc-go">
          {#if view.canConfirm}<button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={() => confirm(open)}>Right</button>{/if}
          <button class="dx-btn small ghost" type="button" onclick={() => desk.tell(`About “${open.label}”: `)}>Change it with the planner</button>
          {#if view.canRemove}<button class="dx-link danger" type="button" disabled={!!desk.busy} onclick={() => remove(open)}>Take it off</button>{/if}
        </div>
      {/if}
      {#if desk.problem?.where === 'brief'}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
    </section>
  {/if}
</div>

<style>
  .bc-row {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
  }
  .bc-item {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 8px;
    max-width: 100%;
  }
  .bc-chip {
    display: inline-flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 2px 8px;
    max-width: 100%;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    background: var(--np-card);
    color: var(--np-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .bc-chip:hover,
  .bc-chip[aria-expanded='true'] {
    border-color: var(--accent-ink);
  }
  .bc-chip:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .bc-label {
    font-weight: 600;
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .bc-origin {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--np-ink-soft);
  }
  /* An assumption: the accent, dashed, with Right / Change beside it. */
  .assumed .bc-chip {
    border: 1px dashed var(--accent);
    background: var(--accent-tint-08);
  }
  .assumed .bc-origin {
    color: var(--np-pen-text);
    font-weight: 600;
  }
  .bc-quick {
    display: inline-flex;
    gap: 10px;
  }
  .bc-missing {
    margin-top: 6px;
    font-size: 15px;
  }
  .bc-panel {
    --np-tilt: 0deg;
    margin-top: 12px;
    padding: 12px 14px;
    max-width: 720px;
  }
  .bc-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-margin-a);
  }
  .bc-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
  }
  .bc-x {
    margin-left: auto;
  }
  .bc-detail {
    margin: 6px 0 0;
    font-size: var(--fs-label);
  }
  .bc-form {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin-top: 10px;
  }
  .bc-form label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--np-pen-ink);
    min-width: 0;
  }
  .bc-form label.wide {
    flex: 1 1 260px;
  }
  .bc-field {
    font-family: var(--font-body);
    font-size: 16px;
    letter-spacing: 0;
    padding: 4px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink);
    min-width: 0;
    max-width: 100%;
  }
  .bc-field.age {
    width: 5em;
  }
  .bc-field:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }
  .bc-set {
    flex: 1 1 100%;
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bc-set legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
    margin-bottom: 4px;
  }
  .bc-form .bc-radio {
    flex-direction: row;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    font-family: var(--font-body);
    font-size: 15px;
    letter-spacing: 0;
    color: var(--np-ink);
  }
  .bc-radio .dx-aside {
    font-size: 15px;
  }
  .bc-person {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px 14px;
  }
  .bc-add {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .bc-go {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-top: 6px;
  }
</style>
