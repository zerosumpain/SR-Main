<script lang="ts">
  // StageFit — the page is a fixed size and nothing scrolls.
  //
  // Drawn against the composer's OWN stated capacities rather than measured in a browser, and
  // labelled as such: these are the limits the model is given, so what the instrument shows is
  // the rule the machine is composing under, not a rendering of any particular slide.
  //
  // The point of making it operable is the fix. Overflow is not solved by smaller type — the
  // instrument will not offer that — it is solved by changing register, which is what the
  // buttons do.
  import { REGISTERS, STAGE } from '../../../lib/decks';

  const SAMPLE =
    'The register is the decision. A page that will not hold its argument at poster scale was ' +
    'never a poster; it is prose, or it is two pages. Choosing which of those it is takes a ' +
    'second and choosing neither takes the audience with it. Whitespace is the loudest signal ' +
    'of importance on any page, and the fastest way to spend all of it is to keep adding lines ' +
    'that each seemed necessary on their own. A slide is not a document with the margins removed. ' +
    'It is the smallest number of things that can be looked at while somebody is talking, and ' +
    'everything else belongs in the notes underneath where it can be read afterwards in peace.';
  const WORDS = SAMPLE.split(/\s+/);

  let reg = $state(REGISTERS[1].id);
  let words = $state(90);

  const register = $derived(REGISTERS.find((r) => r.id === reg) ?? REGISTERS[1]);
  const over = $derived(Math.max(0, words - register.capacity));
  const fits = $derived(over === 0);

  /**
   * Two strings rather than a span per word: adjacent inline elements swallow the whitespace
   * between them, which ran the whole slide together into one unreadable word.
   */
  const wordAt = (i: number) => WORDS[i % WORDS.length];
  const kept = $derived(
    Array.from({ length: Math.min(words, register.capacity) }, (_, i) => wordAt(i)).join(' '),
  );
  const spilled = $derived(
    Array.from({ length: over }, (_, i) => wordAt(register.capacity + i)).join(' '),
  );
</script>

<div class="sf">
  <div class="ctl">
    <div class="regs" role="group" aria-label="Register">
      {#each REGISTERS as r (r.id)}
        <button type="button" class:on={reg === r.id} aria-pressed={reg === r.id}
                onclick={() => (reg = r.id)}>{r.label}<em>{r.capacity}w</em></button>
      {/each}
    </div>
    <label class="f">
      <span class="f-lab">Words of content</span>
      <input type="range" min="10" max="200" step="5" bind:value={words} />
      <output>{words}</output>
    </label>
  </div>

  <div class="stage-wrap">
    <div class="stage" class:over={!fits} data-reg={reg}
         role="img"
         aria-label="A {STAGE.w} by {STAGE.h} page at the {register.label} register holds about {register.capacity} words. {words} words {fits ? 'fits' : `overflows by ${over}`}.">
      <span class="s-kicker">{register.label}</span>
      <p class="s-body">{kept}{#if spilled}<span class="cut"> {spilled}</span>{/if}</p>
      {#if !fits}
        <span class="s-cut" aria-hidden="true"><i>cut off — nothing scrolls</i></span>
      {/if}
    </div>
    <span class="s-dim">{STAGE.w} × {STAGE.h}, fixed</span>
  </div>

  <p class="verdict" aria-live="polite">
    {#if fits}
      <b>Fits.</b> {register.what}
    {:else}
      <b>{over} words past the edge, and they are gone.</b> {register.fix}
    {/if}
  </p>
</div>

<style>
  .sf { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .ctl { display: flex; align-items: center; justify-content: space-between; gap: 10px 20px; flex-wrap: wrap; }
  .regs { display: flex; gap: 5px; flex-wrap: wrap; }
  .regs button { display: inline-flex; align-items: baseline; gap: 6px;
    font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .regs button em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    color: rgba(28,22,17,0.45); }
  .regs button:hover { background: rgba(28,22,17,0.07); }
  .regs button.on { background: var(--success); border-color: var(--success); color: #fff; }
  .regs button.on em { color: rgba(255,255,255,0.7); }

  .f { display: flex; align-items: center; gap: 8px; }
  .f-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); white-space: nowrap; }
  .f input { accent-color: var(--success); width: 128px; }
  .f output { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 600;
    color: var(--text-primary); min-width: 3ch; }

  /* Capped, because a 16:9 box at full page width is 800px tall and reads as a wall. */
  .stage-wrap { position: relative; max-width: 820px; }
  /* A container, so the type scales with the SLIDE rather than with the browser window —
     which is what makes the word capacities below line up with where the page actually ends. */
  .stage { container-type: inline-size;
    position: relative; aspect-ratio: 16 / 9; overflow: hidden;
    background: #fdfbf6; border: 1px solid rgba(28,22,17,0.22); border-radius: var(--radius-round);
    padding: 4% 6%; display: flex; flex-direction: column; gap: 2%; }
  .stage.over { border-color: rgba(138,45,58,0.6); }
  /* Positioned so they paint AFTER the absolutely-positioned backdrop below. */
  .s-kicker { position: relative; font-family: 'JetBrains Mono', monospace; font-size: 1.1cqw;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--success); flex-shrink: 0; }
  .s-body { position: relative; margin: 0; color: rgba(28,22,17,0.82); min-width: 0; }
  /* Sized so that the register's word capacity is roughly a full page — otherwise the strike
     through would fall somewhere with obvious room left, and contradict the instrument. */
  .stage[data-reg='editorial'] .s-body { font-size: 2.35cqw; line-height: 1.5; max-width: 72%; }
  .stage[data-reg='statement'] .s-body { font-family: 'Fraunces', serif; font-weight: 600;
    font-size: 3.25cqw; line-height: 1.14; max-width: 52%; letter-spacing: -0.015em; }
  .stage[data-reg='split'] .s-body { font-size: 2.4cqw; line-height: 1.5; max-width: 38%; }
  .stage[data-reg='poster'] .s-body { font-family: 'Fraunces', serif; font-weight: 600;
    font-size: 4.15cqw; line-height: 1.2; max-width: 60%; }
  /* Where the visual would sit. ::before, so the words paint over it. */
  .stage[data-reg='split']::before {
    content: ''; position: absolute; inset: 0 0 0 auto; width: 58%;
    background: repeating-linear-gradient(135deg, rgba(28,22,17,0.05) 0 6px, transparent 6px 12px);
    border-left: 1px dashed rgba(28,22,17,0.2); pointer-events: none; }
  .stage[data-reg='poster']::before {
    content: ''; position: absolute; inset: 0;
    background: repeating-linear-gradient(135deg, rgba(28,22,17,0.07) 0 6px, transparent 6px 12px);
    pointer-events: none; }
  .s-body .cut { color: rgba(138,45,58,0.55); text-decoration: line-through; }
  /* The page edge IS the bottom of the box, so the marker sits there rather than at some
     arbitrary height — an inset dashed line reads as "the cut is here" and it is not. */
  .s-cut { position: absolute; right: 0; bottom: 0; left: 0; height: 18%;
    background: linear-gradient(to bottom, transparent, rgba(138,45,58,0.2));
    border-bottom: 2px solid rgba(138,45,58,0.6); pointer-events: none; }
  .s-cut i { position: absolute; right: 8px; bottom: 5px; font-style: normal;
    font-family: 'JetBrains Mono', monospace; font-size: 1.05cqw; letter-spacing: 0.08em;
    text-transform: uppercase; color: #8a2d3a; }
  .s-dim { position: absolute; right: 6px; top: -14px; font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px; letter-spacing: 0.08em; color: rgba(28,22,17,0.4); }

  .verdict { margin: 0; padding: 9px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent);
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .verdict b { color: var(--text-primary); }

  @media (max-width: 560px) { .f input { width: 96px; } }
</style>
