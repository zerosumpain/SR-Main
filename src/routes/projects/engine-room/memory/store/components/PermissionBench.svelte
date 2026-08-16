<script lang="ts">
  // PermissionBench — who may do what to this row, and which rule decided.
  //
  // Two things make this worth operating rather than reading. The precedence chain is short
  // enough to hold in your head but the fallback is PER ACTION, so a map with only `read` set
  // does not silently lock everything else — and you only believe that once you have watched
  // a delete resolve one level lower than the read beside it.
  import { ACTORS, RECORDS, PRECEDENCE } from '../../../lib/store';

  type Action = 'read' | 'write' | 'delete';
  const ACTIONS: Action[] = ['read', 'write', 'delete'];

  let recordId = $state(RECORDS[0].id);
  let actor = $state(ACTORS[0].id);

  const record = $derived(RECORDS.find((r) => r.id === recordId) ?? RECORDS[0]);
  const who = $derived(ACTORS.find((a) => a.id === actor) ?? ACTORS[0]);

  /** The collection's own default, and the built-in fallback. Fixed for the bench. */
  const COLLECTION: Partial<Record<Action, string[]>> = { read: ['owner', 'jkai', 'system'] };
  const BUILTIN = ['owner', 'jkai'];

  function listFor(action: Action): { list: string[]; from: (typeof PRECEDENCE)[number]['id'] } {
    const onRecord = record.perms?.[action];
    if (Array.isArray(onRecord)) return { list: onRecord, from: 'record' };
    const onCollection = COLLECTION[action];
    if (Array.isArray(onCollection)) return { list: onCollection, from: 'collection' };
    return { list: BUILTIN, from: 'builtin' };
  }

  function granted(list: string[], id: string): boolean {
    if (id === 'owner') return true; // the owner can never be locked out
    if (list.includes('*')) return true;
    if (list.includes('workflow:*') && id.startsWith('workflow:')) return true;
    return list.includes(id);
  }

  const rows = $derived(
    ACTIONS.map((action) => {
      const { list, from } = listFor(action);
      return { action, list, from, ok: granted(list, who.id) };
    }),
  );

  const fromLabel = (id: string) => PRECEDENCE.find((p) => p.id === id)?.label ?? id;
  const reason = (r: (typeof rows)[number]) => {
    if (who.id === 'owner') return 'the owner always passes';
    if (r.list.includes('*')) return 'matched by *';
    if (r.list.includes('workflow:*') && who.id.startsWith('workflow:')) return 'matched by workflow:*';
    if (r.ok) return 'listed by name';
    return 'not on the list';
  };
</script>

<div class="pb">
  <div class="pick">
    <span class="k" id="pb-rec">The record</span>
    <div class="row" role="group" aria-labelledby="pb-rec">
      {#each RECORDS as r (r.id)}
        <button type="button" class:on={recordId === r.id} aria-pressed={recordId === r.id}
                onclick={() => (recordId = r.id)}>{r.label}</button>
      {/each}
    </div>
  </div>

  <div class="pick">
    <span class="k" id="pb-actor">Asking on behalf of</span>
    <div class="row" role="group" aria-labelledby="pb-actor">
      {#each ACTORS as a (a.id)}
        <button type="button" class:on={actor === a.id} aria-pressed={actor === a.id}
                onclick={() => (actor = a.id)}><code>{a.label}</code></button>
      {/each}
    </div>
  </div>

  <table class="grid">
    <thead>
      <tr><th>Action</th><th>Allowed to</th><th>Decided by</th><th class="v">Verdict</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.action)}
        <tr class:ok={r.ok} class:no={!r.ok}>
          <td class="a">{r.action}</td>
          <td class="l">{#each r.list as e (e)}<code>{e}</code>{/each}</td>
          <td class="f">{fromLabel(r.from)}</td>
          <td class="v"><b>{r.ok ? 'yes' : 'no'}</b><em>{reason(r)}</em></td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="say" aria-live="polite">
    <b>{who.label}.</b> {who.what}
  </p>
  <p class="story">{record.story}</p>
</div>

<style>
  .pb { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .k { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  .row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
  .row button { font-family: var(--font-body); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-sharp); padding: 5px 11px; cursor: pointer; }
  .row button:hover { background: rgba(28,22,17,0.07); }
  .row button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .row button code { font-family: var(--font-mono); font-size: var(--fs-label-xs); }

  .grid { width: 100%; border-collapse: separate; border-spacing: 0 3px; font-size: var(--fs-label); }
  .grid th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.1em; text-transform: uppercase; color: rgba(28,22,17,0.45); font-weight: 400;
    padding: 0 10px 2px; }
  .grid td { background: rgba(255,255,255,0.55); padding: 7px 10px; vertical-align: baseline; }
  .grid tr.ok td:first-child { border-left: 3px solid var(--success); }
  .grid tr.no td:first-child { border-left: 3px solid #8a2d3a; }
  .grid tr td:first-child { border-radius: var(--radius-sharp) 0 0 var(--radius-sharp); }
  .grid tr td:last-child { border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; }
  .grid tr.no td { background: rgba(138,45,58,0.06); }
  .a { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); }
  .l code { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: rgba(28,22,17,0.07);
    padding: 1px 6px; border-radius: var(--radius-pill); margin-right: 4px; color: rgba(28,22,17,0.7);
    display: inline-block; }
  .f { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); }
  .v { text-align: right; white-space: nowrap; }
  .v b { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); }
  tr.no .v b { color: #8a2d3a; }
  .v em { display: block; font-style: normal; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); }

  .say, .story { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .say b { color: var(--text-primary); }
  .story { padding: 9px 13px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--accent) 9%, transparent); }

  @media (max-width: 620px) {
    .grid, .grid tbody, .grid tr, .grid td { display: block; width: 100%; }
    .grid thead { display: none; }
    .grid tr { margin-bottom: 6px; }
    .grid td { border-radius: 0; }
    .v { text-align: left; }
  }
</style>
