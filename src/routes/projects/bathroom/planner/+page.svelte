<script lang="ts">
  import FloorPlan from '../components/FloorPlan.svelte';
  import {
    FIX,
    PALETTE_GROUPS,
    clamp,
    foot,
    place,
    wallLength,
    type Wall,
  } from '../lib/fixtures';
  import { checks, stats } from '../lib/checks';
  import { PRESETS } from '../lib/presets';
  import {
    addItem,
    clearRoom,
    loadPreset,
    persist,
    reflow,
    removeItem,
    rotateItem,
    s,
    ui,
  } from '../lib/state.svelte';

  const plan = $derived(s.plan);
  const issues = $derived(checks(s.plan));
  const st = $derived(stats(s.plan));
  const selItem = $derived(s.plan.items.find((i) => i.id === ui.sel) ?? null);

  const MARK: Record<string, string> = { crit: '!', warn: '~', good: '✓', info: 'i' };

  function roomChanged() {
    s.plan.W = clamp(Math.round(s.plan.W) || 2100, 900, 6000);
    s.plan.D = clamp(Math.round(s.plan.D) || 2400, 900, 6000);
    clampOpenings();
    reflow();
  }

  function clampOpenings() {
    const p = s.plan;
    p.door.pos = clamp(p.door.pos, 0, Math.max(0, wallLength(p, p.door.wall) - p.door.w));
    p.win.pos = clamp(p.win.pos, 0, Math.max(0, wallLength(p, p.win.wall) - p.win.w));
    p.stack.pos = clamp(p.stack.pos, 0, wallLength(p, p.stack.wall));
    if (p.notch.on) {
      p.notch.w = clamp(p.notch.w, 100, p.W - 100);
      p.notch.d = clamp(p.notch.d, 100, p.D - 100);
    }
    persist();
  }

  function centreOnWall() {
    if (!selItem) return;
    const b = foot(selItem);
    if (selItem.r % 180 === 0) place(s.plan, selItem, (s.plan.W - b.w) / 2, selItem.y);
    else place(s.plan, selItem, selItem.x, (s.plan.D - b.h) / 2);
    persist();
  }

  function onKey(ev: KeyboardEvent) {
    if (ui.sel == null || !selItem) return;
    const t = ev.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const step = ev.shiftKey ? 10 : 50;
    let used = true;
    if (ev.key === 'ArrowLeft') place(s.plan, selItem, selItem.x - step, selItem.y);
    else if (ev.key === 'ArrowRight') place(s.plan, selItem, selItem.x + step, selItem.y);
    else if (ev.key === 'ArrowUp') place(s.plan, selItem, selItem.x, selItem.y - step);
    else if (ev.key === 'ArrowDown') place(s.plan, selItem, selItem.x, selItem.y + step);
    else if (ev.key === 'r' || ev.key === 'R') rotateItem(ui.sel);
    else if (ev.key === 'Delete' || ev.key === 'Backspace') removeItem(ui.sel);
    else used = false;
    if (used) {
      ev.preventDefault();
      persist();
    }
  }

  const WALLS: { v: Wall; l: string }[] = [
    { v: 'N', l: 'Top' },
    { v: 'S', l: 'Bottom' },
    { v: 'W', l: 'Left' },
    { v: 'E', l: 'Right' },
  ];
</script>

<svelte:head>
  <title>Planner — Bathroom Planner</title>
</svelte:head>
<svelte:window onkeydown={onKey} />

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">03 · Planner</span>
    <h1 class="bth-h1">Your floor plan, to scale</h1>
    <p class="bth-lead">
      Put your real measurements in, then drag fittings around. Everything is drawn at true size in
      millimetres, with the space you need to stand in front of each thing shown as a dashed zone.
      If two of those overlap, you'll be climbing over the toilet to get in the shower — and the
      checklist will say so.
    </p>
  </header>

  <div class="planner">
    <div class="bth-stack g12">
      <div class="bth-row">
        {#each PRESETS as p (p.key)}
          <button class="bth-btn" type="button" title={p.note} onclick={() => loadPreset(p.key)}>
            {p.label}
          </button>
        {/each}
        <button
          class="bth-btn"
          type="button"
          aria-pressed={plan.snap}
          onclick={() => { s.plan.snap = !s.plan.snap; persist(); }}>Snap to walls</button
        >
        <button
          class="bth-btn"
          type="button"
          aria-pressed={plan.zones}
          onclick={() => { s.plan.zones = !s.plan.zones; persist(); }}>Show standing space</button
        >
        <button class="bth-btn" type="button" onclick={clearRoom}>Empty the room</button>
      </div>

      <div class="stage">
        <FloorPlan
          {plan}
          selected={ui.sel}
          onselect={(id) => (ui.sel = id)}
          onchange={persist}
        />
      </div>

      <div class="selbar">
        {#if selItem}
          <strong>{FIX[selItem.t].n}</strong>
          <span class="bth-muted">{FIX[selItem.t].w}×{FIX[selItem.t].d} mm</span>
          <button class="bth-btn" type="button" onclick={() => rotateItem(selItem.id)}>
            Rotate {selItem.r}°
          </button>
          <button class="bth-btn" type="button" onclick={centreOnWall}>Centre on wall</button>
          <button class="bth-btn" type="button" onclick={() => removeItem(selItem.id)}>Remove</button>
        {:else}
          <span class="bth-muted">Nothing selected — tap a fitting to move, rotate or remove it.</span>
        {/if}
      </div>

      <div class="bth-tiles">
        <div>
          <div class="k">Floor area</div>
          <div class="v">{st.area.toFixed(2)}</div>
          <div class="s">m² overall</div>
        </div>
        <div>
          <div class="k">Clear floor</div>
          <div class="v">{st.free.toFixed(2)}</div>
          <div class="s">m² · {Math.round(st.freePct)}% of the room</div>
        </div>
        <div>
          <div class="k">Wall perimeter</div>
          <div class="v">{st.perim.toFixed(1)}</div>
          <div class="s">m · sets your tiling</div>
        </div>
        <div>
          <div class="k">WC to stack</div>
          <div class="v">{st.stackDist == null ? '—' : (st.stackDist / 1000).toFixed(2)}</div>
          <div class="s">{st.stackDist == null ? 'no WC placed' : 'm centre to stack'}</div>
        </div>
      </div>

      <p class="bth-small bth-muted">
        Drag to move. Tap to select, then use the buttons or the arrow keys (hold Shift for 10 mm
        nudges). Press <kbd>R</kbd> to rotate, <kbd>Delete</kbd> to remove. Everything saves in this
        browser as you go.
      </p>
    </div>

    <aside class="side">
      <div class="box bth-stack g12">
        <h2 class="bth-h3">The room</h2>
        <div class="pair">
          <div class="bth-field">
            <label for="rw">Width (mm)</label>
            <input
              class="bth-input"
              id="rw"
              type="number"
              min="900"
              max="6000"
              step="10"
              bind:value={s.plan.W}
              oninput={roomChanged}
            />
          </div>
          <div class="bth-field">
            <label for="rd">Depth (mm)</label>
            <input
              class="bth-input"
              id="rd"
              type="number"
              min="900"
              max="6000"
              step="10"
              bind:value={s.plan.D}
              oninput={roomChanged}
            />
          </div>
        </div>
        <hr class="bth-rule" />
        <div class="pair">
          <div class="bth-field">
            <label for="dwall">Door on</label>
            <select class="bth-input" id="dwall" bind:value={s.plan.door.wall} onchange={clampOpenings}>
              {#each WALLS as w (w.v)}<option value={w.v}>{w.l} wall</option>{/each}
            </select>
          </div>
          <div class="bth-field">
            <label for="dpos">From corner</label>
            <input class="bth-input" id="dpos" type="number" min="0" step="10" bind:value={s.plan.door.pos} oninput={clampOpenings} />
          </div>
        </div>
        <div class="pair">
          <div class="bth-field">
            <label for="dw">Door width</label>
            <select class="bth-input" id="dw" bind:value={s.plan.door.w} onchange={clampOpenings}>
              <option value={686}>686 mm</option>
              <option value={762}>762 mm</option>
              <option value={838}>838 mm</option>
            </select>
          </div>
          <div class="bth-field">
            <label for="dsw">Opens</label>
            <select class="bth-input" id="dsw" bind:value={s.plan.door.swing} onchange={persist}>
              <option value="in-l">In, left</option>
              <option value="in-r">In, right</option>
              <option value="out">Outwards</option>
              <option value="slide">Slides</option>
            </select>
          </div>
        </div>
        <hr class="bth-rule" />
        <label class="bth-check">
          <input type="checkbox" bind:checked={s.plan.win.on} onchange={persist} /> There's a window
        </label>
        {#if plan.win.on}
          <div class="pair">
            <div class="bth-field">
              <label for="wwall">On wall</label>
              <select class="bth-input" id="wwall" bind:value={s.plan.win.wall} onchange={clampOpenings}>
                {#each WALLS as w (w.v)}<option value={w.v}>{w.l}</option>{/each}
              </select>
            </div>
            <div class="bth-field">
              <label for="wpos">From corner</label>
              <input class="bth-input" id="wpos" type="number" min="0" step="10" bind:value={s.plan.win.pos} oninput={clampOpenings} />
            </div>
          </div>
          <div class="bth-field">
            <label for="ww">Window width (mm)</label>
            <input class="bth-input" id="ww" type="number" min="300" max="3000" step="10" bind:value={s.plan.win.w} oninput={clampOpenings} />
          </div>
        {/if}
        <hr class="bth-rule" />
        <div class="pair">
          <div class="bth-field">
            <label for="swall">Soil stack on</label>
            <select class="bth-input" id="swall" bind:value={s.plan.stack.wall} onchange={clampOpenings}>
              {#each WALLS as w (w.v)}<option value={w.v}>{w.l} wall</option>{/each}
            </select>
          </div>
          <div class="bth-field">
            <label for="spos">From corner</label>
            <input class="bth-input" id="spos" type="number" min="0" step="10" bind:value={s.plan.stack.pos} oninput={clampOpenings} />
          </div>
        </div>
        <hr class="bth-rule" />
        <label class="bth-check">
          <input type="checkbox" bind:checked={s.plan.notch.on} onchange={clampOpenings} /> Chimney breast / bulkhead
        </label>
        {#if plan.notch.on}
          <div class="pair">
            <div class="bth-field">
              <label for="ncor">In corner</label>
              <select class="bth-input" id="ncor" bind:value={s.plan.notch.corner} onchange={persist}>
                <option value="NE">Top right</option>
                <option value="NW">Top left</option>
                <option value="SE">Bottom right</option>
                <option value="SW">Bottom left</option>
              </select>
            </div>
            <div class="bth-field">
              <label for="nw">Width</label>
              <input class="bth-input" id="nw" type="number" min="100" step="10" bind:value={s.plan.notch.w} oninput={clampOpenings} />
            </div>
          </div>
          <div class="bth-field">
            <label for="nd">Projection</label>
            <input class="bth-input" id="nd" type="number" min="100" step="10" bind:value={s.plan.notch.d} oninput={clampOpenings} />
          </div>
        {/if}
      </div>

      <div class="box bth-stack g12">
        <h2 class="bth-h3">Add a fitting</h2>
        <div class="palette">
          {#each PALETTE_GROUPS as [group, ids] (group)}
            <div class="palgroup">{group}</div>
            {#each ids as id (id)}
              <button type="button" onclick={() => addItem(id)}>
                {FIX[id].n}<span class="dim">{FIX[id].w}×{FIX[id].d}</span>
              </button>
            {/each}
          {/each}
        </div>
      </div>

      <div class="box bth-stack g8">
        <h2 class="bth-h3">In the room</h2>
        {#if !plan.items.length}
          <p class="bth-small bth-muted">Nothing placed yet.</p>
        {:else}
          {#each plan.items as it (it.id)}
            <div class="itemrow">
              <button class="namebtn" type="button" onclick={() => (ui.sel = it.id)}>{FIX[it.t].n}</button>
              <button class="bth-btn" type="button" onclick={() => removeItem(it.id)}>Remove</button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="box bth-stack g12">
        <h2 class="bth-h3">Check</h2>
        <div class="bth-stack g8">
          {#each issues as issue, i (i)}
            <div class="issue {issue.level}">
              <span class="mk" aria-hidden="true">{MARK[issue.level]}</span>
              <span>{issue.text}</span>
            </div>
          {/each}
        </div>
      </div>
    </aside>
  </div>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Why the dashed boxes matter</span>
      <h2 class="bth-h2">The numbers behind the layout</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <div class="bth-stack g16">
        <p class="bth-body">
          There's no law about how much space you need in front of a toilet, but there is a widely
          used rule of thumb, and every fitter and designer works to something like it. Ignore it
          and the room is technically fine and practically horrible.
        </p>
        <div class="bth-tablewrap">
          <table>
            <thead><tr><th>In front of</th><th>Comfortable</th><th>Tight but liveable</th></tr></thead>
            <tbody>
              <tr><td>Toilet (front and each side)</td><td class="n">700 mm / 200 mm</td><td class="n">600 mm / 150 mm</td></tr>
              <tr><td>Basin</td><td class="n">700 mm</td><td class="n">550 mm</td></tr>
              <tr><td>Bath (long side)</td><td class="n">700 mm</td><td class="n">600 mm</td></tr>
              <tr><td>Shower entry</td><td class="n">700 mm</td><td class="n">600 mm</td></tr>
              <tr><td>Between two facing fittings</td><td class="n">750 mm</td><td class="n">600 mm</td></tr>
              <tr><td>Door opening</td><td class="n">762 mm</td><td class="n">686 mm</td></tr>
            </tbody>
          </table>
        </div>
        <p class="bth-small bth-muted">
          The planner uses the comfortable column. Clashes in the dashed zones are flagged as tight
          rather than wrong — plenty of perfectly nice bathrooms break one of these. Two or three
          clashes at once is when a room starts to feel like a cupboard.
        </p>
      </div>
      <div class="bth-stack g16">
        <div class="bth-card">
          <h3 class="bth-h3">Standard sizes, so you can sanity-check a quote</h3>
          <div class="bth-tablewrap">
            <table>
              <thead><tr><th>Fitting</th><th>Typical size</th></tr></thead>
              <tbody>
                <tr><td>Bath, standard</td><td class="n">1700 × 700</td></tr>
                <tr><td>Bath, small</td><td class="n">1500–1600 × 700</td></tr>
                <tr><td>Shower bath (P shape)</td><td class="n">1700 × 850</td></tr>
                <tr><td>Shower tray, square</td><td class="n">900 × 900</td></tr>
                <tr><td>Walk-in tray</td><td class="n">1400–1700 × 800–900</td></tr>
                <tr><td>Close-coupled WC</td><td class="n">370 wide × 700 deep</td></tr>
                <tr><td>Wall-hung WC + frame</td><td class="n">370 wide × 560 deep</td></tr>
                <tr><td>Pedestal basin</td><td class="n">550 × 450</td></tr>
                <tr><td>Vanity unit</td><td class="n">600–1000 × 450</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="bth-note warn">
          <span class="bth-eyebrow">The soil stack rule</span>
          <p class="bth-small">
            A toilet wants to be within about 1.5 m of the soil stack, running at a fall of roughly
            1:40 in 110 mm pipe. Between 1.5 m and 3 m it's doable but you'll be boxing in a fat
            pipe or losing floor height. Beyond that you're into a macerator, which works fine,
            needs power, and is one more thing to break. The planner measures this for you.
          </p>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .planner {
    display: grid;
    gap: 1rem;
    grid-template-columns: minmax(0, 1fr) 320px;
    align-items: start;
  }
  @media (max-width: 940px) {
    .planner { grid-template-columns: minmax(0, 1fr); }
  }
  .stage {
    background: var(--surface-card);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 0.4rem;
    touch-action: none;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }
  .box {
    background: var(--surface-card);
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    padding: 0.9rem 1rem;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }
  .selbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.55rem 0.7rem;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg-section);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .palette {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.3rem;
  }
  .palgroup {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    padding-top: 0.35rem;
  }
  .palette button {
    text-align: left;
    background: var(--bg-section);
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    padding: 0.35rem 0.45rem;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    line-height: 1.3;
  }
  .palette button:hover {
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .palette .dim {
    display: block;
    color: var(--text-ghost);
  }
  .itemrow {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .itemrow:last-child { border-bottom: 0; }
  .namebtn {
    flex: 1 1 auto;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .namebtn:hover { color: var(--accent); }
  .issue {
    display: flex;
    gap: 0.55rem;
    align-items: flex-start;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .issue .mk {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-sharp);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    margin-top: 1px;
  }
  .issue.crit .mk { background: var(--error-bg); color: var(--error); }
  .issue.warn .mk { background: var(--warn-bg); color: var(--warn); }
  .issue.good .mk { background: var(--success-bg); color: var(--success); }
  .issue.info .mk { background: var(--bg-section); color: var(--text-muted); }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--bg-section);
    padding: 0.05em 0.3em;
    border-radius: var(--radius-sharp);
  }
</style>
