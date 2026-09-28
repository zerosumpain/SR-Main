<script lang="ts">
  // What one person (or one role) may do: a role, then family as one choice,
  // then one row per area with only the choices that differ. Every row shows
  // what they will HOLD — the role's level is a floor, drawn as such and not
  // lowerable here; picking above it is an add. The server prunes adds the
  // role already gives, so the editor never has to.
  //
  // Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md
  import type { Level, Permission } from '$lib/access/catalogue';
  import {
    AREA_CHOICES,
    EDITABLE_AREAS,
    FAMILY_CHOICES,
    familyLevel,
    heldChoice,
    withAreaLevel,
    withFamily,
    type FamilyLevel,
  } from '$lib/access/roles';

  interface RoleOption {
    id: string;
    label: string;
    description: string | null;
    grants: Permission[];
  }

  let {
    roles = [],
    role = $bindable(null),
    grants = $bindable([]),
    showRoles = true,
    name,
  }: {
    roles?: RoleOption[];
    role?: string | null;
    grants?: Permission[];
    /** False when editing a role itself: there is no role above a role. */
    showRoles?: boolean;
    /** Unique per editor on the page: it names the radio groups. */
    name: string;
  } = $props();

  const LEVEL_ORDER: (Level | null)[] = [null, 'self', 'all', 'admin'];
  const rank = (l: Level | null) => LEVEL_ORDER.indexOf(l);
  const FAMILY_ORDER: FamilyLevel[] = ['none', 'circle', 'parent'];

  const roleGrants = $derived(roles.find((r) => r.id === role)?.grants ?? []);
  const roleLabel = $derived(roles.find((r) => r.id === role)?.label ?? '');

  function floorOf(area: (typeof EDITABLE_AREAS)[number]['id']): Level | null {
    return heldChoice(roleGrants, area);
  }
  function shown(area: (typeof EDITABLE_AREAS)[number]['id']): Level | null {
    const floor = floorOf(area);
    const own = heldChoice(grants, area);
    return rank(own) > rank(floor) ? own : floor;
  }
  const familyFloor = $derived(familyLevel(roleGrants));
  const familyShown = $derived.by(() => {
    const own = familyLevel(grants);
    return FAMILY_ORDER.indexOf(own) > FAMILY_ORDER.indexOf(familyFloor) ? own : familyFloor;
  });
</script>

<div class="access-editor">
  {#if showRoles}
    <fieldset class="block">
      <legend class="sr-label-tight">Role</legend>
      <div class="roles">
        <label class="role" class:on={role === null}>
          <input type="radio" name="{name}-role" checked={role === null} onchange={() => (role = null)} />
          <span class="role-name">No role</span>
          <span class="role-blurb">Only what you add below. With nothing, public pages only.</span>
        </label>
        {#each roles as r (r.id)}
          <label class="role" class:on={role === r.id}>
            <input type="radio" name="{name}-role" checked={role === r.id} onchange={() => (role = r.id)} />
            <span class="role-name">{r.label}</span>
            {#if r.description}<span class="role-blurb">{r.description}</span>{/if}
          </label>
        {/each}
      </div>
    </fieldset>
  {/if}

  <fieldset class="block">
    <legend class="sr-label-tight">Family</legend>
    <div class="row">
      <div class="row-head">
        <span class="area-name">Locations</span>
        <span class="area-blurb">{FAMILY_CHOICES.find((c) => c.value === familyShown)?.blurb}</span>
      </div>
      <div class="seg" role="radiogroup" aria-label="Family">
        {#each FAMILY_CHOICES as c (c.value)}
          {@const below = FAMILY_ORDER.indexOf(c.value) < FAMILY_ORDER.indexOf(familyFloor)}
          <label class="seg-opt" class:on={familyShown === c.value} class:locked={below}>
            <input
              type="radio"
              name="{name}-family"
              checked={familyShown === c.value}
              disabled={below}
              onchange={() => (grants = withFamily(grants, c.value))}
            />
            {c.label}
          </label>
        {/each}
      </div>
      {#if familyFloor !== 'none'}<span class="from">from {roleLabel}</span>{/if}
    </div>
  </fieldset>

  <fieldset class="block">
    <legend class="sr-label-tight">Areas</legend>
    {#each EDITABLE_AREAS as area (area.id)}
      {@const floor = floorOf(area.id)}
      {@const held = shown(area.id)}
      <div class="row">
        <div class="row-head">
          <span class="area-name">{area.label}</span>
          <span class="area-blurb">{held ? area.levels[held] : area.blurb}</span>
        </div>
        <div class="seg" role="radiogroup" aria-label={area.label}>
          {#each AREA_CHOICES[area.id] as c (c.level ?? 'off')}
            {@const below = rank(c.level) < rank(floor)}
            <label class="seg-opt" class:on={held === c.level} class:locked={below}>
              <input
                type="radio"
                name="{name}-{area.id}"
                checked={held === c.level}
                disabled={below}
                onchange={() => (grants = withAreaLevel(grants, area.id, c.level))}
              />
              {c.label}
            </label>
          {/each}
        </div>
        {#if floor}<span class="from">from {roleLabel}</span>{/if}
      </div>
    {/each}
  </fieldset>
</div>

<style>
  .access-editor {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .block {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .block legend {
    margin-bottom: 0.4rem;
  }
  .roles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: 0.5rem;
  }
  .role {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--divider);
    border-radius: 2px;
    cursor: pointer;
  }
  .role.on {
    border-color: var(--accent-ink);
    border-left-width: 4px;
  }
  .role input,
  .seg-opt input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .role:focus-within,
  .seg-opt:focus-within {
    outline: 2px solid var(--accent-ink);
    outline-offset: 1px;
  }
  .role-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 0.9rem;
  }
  .role-blurb {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 6.5rem;
    align-items: center;
    gap: 0.4rem 0.9rem;
    padding: 0.45rem 0;
    border-bottom: 1px solid var(--divider);
  }
  .row-head {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .area-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .area-blurb {
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  .seg-opt {
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.25rem 0.55rem;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .seg-opt + .seg-opt {
    border-left: 1px solid var(--divider);
  }
  .seg-opt.on {
    background: var(--accent-ink);
    color: var(--bg);
  }
  .seg-opt.locked {
    color: var(--text-ghost);
    cursor: not-allowed;
  }
  .from {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  @media (max-width: 720px) {
    .row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
