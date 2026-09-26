<script lang="ts">
  // A grid of areas × none/self/all/admin plus the family permissions, for a
  // person's one-off grants or a group's grants. Areas whose routes have not
  // opened yet are shown and disabled, labelled — a tick that opens nothing
  // would be a grant that silently does nothing.
  import {
    AREAS,
    FAMILY,
    LEVELS,
    levelOf,
    type AreaId,
    type Level,
    type Permission,
  } from '$lib/access/catalogue';

  let {
    grants,
    name,
    onchange,
  }: {
    grants: readonly Permission[];
    /** Unique per editor on the page: it names the radio groups. */
    name: string;
    onchange: (next: Permission[]) => void;
  } = $props();

  function setLevel(area: AreaId, level: Level | null) {
    const rest = grants.filter((g) => !g.startsWith(`${area}:`));
    onchange(level ? [...rest, `${area}:${level}` as Permission] : rest);
  }

  function toggle(p: Permission, on: boolean) {
    const rest = grants.filter((g) => g !== p);
    onchange(on ? [...rest, p] : rest);
  }
</script>

<table class="grid">
  <thead>
    <tr>
      <th scope="col" class="area-col"><span class="sr-label-tight">Area</span></th>
      <th scope="col"><span class="sr-label-tight">None</span></th>
      {#each LEVELS as level}
        <th scope="col"><span class="sr-label-tight">{level}</span></th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each AREAS as area (area.id)}
      {@const held = levelOf(grants, area.id)}
      <tr class:closed={!area.open}>
        <th scope="row" class="area-col">
          <span class="area-name">{area.label}</span>
          <span class="area-blurb">{area.open ? area.blurb : 'Not yet open'}</span>
        </th>
        <td>
          <input
            type="radio"
            name="{name}-{area.id}"
            checked={held === null}
            disabled={!area.open}
            aria-label="{area.label}: none"
            onchange={() => setLevel(area.id, null)}
          />
        </td>
        {#each LEVELS as level}
          <td>
            <input
              type="radio"
              name="{name}-{area.id}"
              checked={held === level}
              disabled={!area.open}
              aria-label="{area.label}: {level}"
              title={area.levels[level]}
              onchange={() => setLevel(area.id, level)}
            />
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
</table>

<div class="family">
  {#each FAMILY as f (f.id)}
    <label class="family-row" class:closed={!f.open}>
      <input
        type="checkbox"
        checked={grants.includes(f.id)}
        disabled={!f.open}
        onchange={(e) => toggle(f.id, e.currentTarget.checked)}
      />
      <span class="area-name">{f.label}</span>
      <span class="area-blurb">{f.open ? f.blurb : `${f.blurb} Not yet open.`}</span>
    </label>
  {/each}
</div>

<style>
  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .grid th,
  .grid td {
    padding: 0.35rem 0.4rem;
    border-bottom: 1px solid var(--divider);
    text-align: center;
  }
  .grid .area-col {
    text-align: left;
    font-weight: 400;
  }
  .area-name {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .area-blurb {
    display: block;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  tr.closed .area-name,
  .family-row.closed .area-name {
    color: var(--text-ghost);
  }
  .family {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.7rem;
  }
  .family-row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 0.6rem;
  }
  input:disabled {
    cursor: not-allowed;
  }
</style>
