<script lang="ts">
  // One note's explanation (HeroNotes), run in as a note is set: its number
  // and head, the words, then the link. Open, it hangs at the foot of the
  // sheet; closed, it is out of the layout, the accessibility tree and the
  // tab order. Set blind (unseen and unread) it only keeps the foot as deep
  // as the longest note, so opening one never moves the page.
  import type { Plate } from '$lib/landing/notes';
  import { noteNumber, type NoteId } from '$lib/landing/sentence';

  let { id, p, open = false, blind = false }: { id: NoteId; p: Plate; open?: boolean; blind?: boolean } = $props();
</script>

{#if blind}
  <p class="hn-plate hn-blind"><span class="hn-plate-head">{noteNumber(id)} · {p.head}</span> {p.text} <span class="hn-plate-a"
      >{p.cta} →</span
    ></p>
{:else}
  <div class="hn-plate" class:open id="np-{id}" role="note" aria-label="Note {noteNumber(id)}">
    <p><span class="hn-plate-head">{noteNumber(id)} · {p.head}</span> {p.text} <a class="hn-plate-a" href={p.href}
        >{p.cta} <span aria-hidden="true">→</span></a
      ></p>
  </div>
{/if}

<style>
  /* Closed: out of the layout, the accessibility tree and the tab order. */
  .hn-plate {
    display: none;
    margin-top: 12px;
    padding: 2px 0 2px 14px;
    border-left: 2px solid var(--tone);
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--on-ink-80);
  }
  .hn-plate.open {
    display: block;
    animation: hn-in var(--t-slow, 360ms) var(--ease-out, ease-out) both;
  }
  @keyframes hn-in {
    from {
      opacity: 0;
    }
  }
  .hn-plate p {
    margin: 0;
  }
  /* Run in, as a note's number and head would be set, so a note is two lines. */
  .hn-plate-head {
    margin-right: 0.5em;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .hn-plate-a {
    position: relative;
    margin-left: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    text-decoration: none;
    white-space: nowrap;
  }
  /* A finger-sized target without opening up the line. */
  .hn-plate-a::after {
    content: '';
    position: absolute;
    inset: -12px -6px;
  }
  .hn-plate-a:hover {
    color: var(--tone);
  }
  .hn-plate-a:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }

  @media (min-width: 761px) {
    .hn-plate {
      min-height: 50px;
      margin: 0;
      padding: 3px 0 3px 14px;
    }
    .hn-blind {
      display: block;
    }
    /* Notes hang from the foot of the sheet, beside the switches, over the
       caption they replace and in the room their blinds keep. */
    .hn-plate:not(.hn-blind) {
      position: absolute;
      z-index: 2;
      left: var(--gut);
      right: calc(var(--gut) + var(--ctl));
      bottom: 0;
      background: var(--text-primary);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hn-plate.open {
      animation: none;
    }
  }
</style>
