<script lang="ts">
  // HouseTree — the same entities a flat list would give you, arranged the way a person
  // thinks about a building, with the call that would be made shown before it is made.
  //
  // The dry-run toggle is the point of making this operable. Reading it as prose, "you can
  // preview the call" sounds like a convenience; watching the payload appear while nothing
  // in the house moves is what makes it read as the safety property it is.
  import { ENTITIES, DOMAIN_LABEL, OPERATIONS } from '../../../lib/house';

  const AREAS = [...new Set(ENTITIES.map((e) => e.area))];

  let area = $state(AREAS[0]);
  let entityId = $state(ENTITIES[0].id);
  let op = $state(OPERATIONS[0].id);
  let dry = $state(true);

  const inArea = $derived(ENTITIES.filter((e) => e.area === area));
  const domains = $derived([...new Set(inArea.map((e) => e.domain))]);
  const entity = $derived(ENTITIES.find((e) => e.id === entityId) ?? ENTITIES[0]);
  const operation = $derived(OPERATIONS.find((o) => o.id === op) ?? OPERATIONS[0]);

  function pickArea(a: string) {
    area = a;
    const first = ENTITIES.find((e) => e.area === a);
    if (first) entityId = first.id;
  }

  /** A service a domain would plausibly take. Illustrative, like the house itself. */
  const SERVICE: Record<string, string> = {
    light: 'turn_on', climate: 'set_temperature', media_player: 'media_play',
    cover: 'open_cover', lock: 'lock', sensor: '—', binary_sensor: '—',
  };

  const payload = $derived({
    domain: entity.domain,
    service: SERVICE[entity.domain] ?? 'turn_on',
    entity_id: entity.id,
  });

  const canAct = $derived(entity.actuates);
  const wouldWrite = $derived(operation.writes);
</script>

<div class="ht">
  <div class="cols">
    <div class="col">
      <span class="k">Area</span>
      <div class="list">
        {#each AREAS as a (a)}
          <button type="button" class:on={area === a} aria-pressed={area === a} onclick={() => pickArea(a)}>{a}</button>
        {/each}
      </div>
    </div>
    <div class="col wide">
      <span class="k">What is in it</span>
      <div class="groups">
        {#each domains as d (d)}
          <div class="group">
            <span class="g-lab">{DOMAIN_LABEL[d] ?? d}</span>
            <div class="list">
              {#each inArea.filter((e) => e.domain === d) as e (e.id)}
                <button type="button" class="ent" class:on={entityId === e.id} aria-pressed={entityId === e.id}
                        onclick={() => (entityId = e.id)}>
                  {e.name}<em>{e.state}</em>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="ops">
    <span class="k">Do what with it</span>
    <div class="list">
      {#each OPERATIONS as o (o.id)}
        <button type="button" class:on={op === o.id} class:writes={o.writes} aria-pressed={op === o.id}
                onclick={() => (op = o.id)}>{o.label}</button>
      {/each}
    </div>
  </div>

  {#if wouldWrite}
    <label class="dry">
      <input type="checkbox" bind:checked={dry} />
      <span>Dry run — report the call instead of making it</span>
    </label>
  {/if}

  <div class="out" class:live={wouldWrite && !dry} class:blocked={wouldWrite && !canAct} aria-live="polite">
    {#if !wouldWrite}
      <span class="o-kick">reads back</span>
      <p class="o-body">
        <code>{entity.id}</code> — <b>{entity.state}</b>, in <b>{entity.area}</b>, as
        <b>{entity.name}</b>. The area and the friendly name are joined on from the cached registry;
        the connection itself returns neither.
      </p>
    {:else if !canAct}
      <span class="o-kick">nothing to call</span>
      <p class="o-body">
        <code>{entity.id}</code> is something the house reports, not something it operates. There is no
        service to call on it, which the tree tells you before you wire anything.
      </p>
    {:else if dry}
      <span class="o-kick">would call — nothing has moved</span>
      <pre class="o-pre">{JSON.stringify(payload, null, 2)}</pre>
      <p class="o-body">The same code path with one flag set, so what you are reading is what will run.</p>
    {:else}
      <span class="o-kick">calls it, for real</span>
      <pre class="o-pre">{JSON.stringify(payload, null, 2)}</pre>
      <p class="o-body">Armed. In a real run the house acts on this and the node reports what came back.</p>
    {/if}
  </div>
</div>

<style>
  .ht { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
  .k { display: block; margin-bottom: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--success); }

  .cols { display: grid; grid-template-columns: minmax(120px, 160px) 1fr; gap: 14px; align-items: start; }
  .col.wide { min-width: 0; }
  .list { display: flex; gap: 5px; flex-wrap: wrap; }
  .col:not(.wide) .list { flex-direction: column; }
  .list button { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; text-align: left; }
  .list button:hover { background: rgba(28,22,17,0.07); }
  .list button.on { background: var(--success); border-color: var(--success); color: #fff; }
  .list button.writes { border-style: dashed; }
  .list button.writes.on { border-style: solid; }
  .ent { display: inline-flex; align-items: baseline; gap: 7px; }
  .ent em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.45); }
  .ent.on em { color: rgba(255,255,255,0.7); }

  .groups { display: flex; flex-direction: column; gap: 8px; }
  .g-lab { display: block; margin-bottom: 4px; font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.42); }

  .dry { display: flex; align-items: center; gap: 7px; font-size: 12px; color: rgba(28,22,17,0.7); cursor: pointer; }
  .dry input { accent-color: var(--success); }

  .out { padding: 10px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent); }
  .out.live { border-left-color: #b0892a; background: rgba(176,137,42,0.1); }
  .out.blocked { border-left-color: rgba(28,22,17,0.35); background: rgba(28,22,17,0.05); }
  .o-kick { display: block; margin-bottom: 6px; font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--success); }
  .out.live .o-kick { color: #8a6a1f; }
  .out.blocked .o-kick { color: rgba(28,22,17,0.5); }
  .o-pre { margin: 0 0 7px; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 1.5;
    color: var(--text-primary); background: rgba(255,255,255,0.7); border: 1px solid rgba(28,22,17,0.12);
    border-radius: var(--radius-sharp); padding: 8px 11px; overflow-x: auto; }
  .o-body { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .o-body code { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--text-primary); }
  .o-body b { color: var(--text-primary); }

  @media (max-width: 620px) {
    .cols { grid-template-columns: 1fr; }
    .col:not(.wide) .list { flex-direction: row; flex-wrap: wrap; }
  }
</style>
