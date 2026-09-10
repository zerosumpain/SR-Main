<script lang="ts">
  // A column header that can explain itself.
  //
  // Ask 4: the reader is a policy professional, not a game theorist, and every
  // column on this page is a term of art — "concealment" in a ranking, a check
  // that returns "indeterminate", an origin of "behavioural hypothesis". None of
  // those can be made self-explanatory by renaming them, because the shorter
  // name is the one that is wrong.
  //
  // So the header carries a hairline underline and a `data-pa-peek` attribute,
  // and the section's delegated handlers do the rest. NOTHING IS MOUNTED HERE —
  // there is one card for the whole page, and a header that mounted its own
  // popover would be forty idle components on the playbook alone.
  //
  // It is a <button> because it is operable: hover shows the card, focus pins
  // it, Escape dismisses it. A <span title> would be inert to a keyboard and
  // would put the site's copy inside a native tooltip nobody can style.
  interface Props {
    /** A key `glossary.explain()` knows. */
    term: string;
    /** The visible text. Defaults to the term's own label. */
    text?: string;
    /** Mono uppercase, which is what a table header wants. */
    as?: 'label' | 'inline';
  }

  let { term, text, as = 'label' }: Props = $props();
</script>

<button
  type="button"
  class="ex"
  class:inline={as === 'inline'}
  data-pa-peek={`term:${term}`}
  aria-label={`${text ?? term} — what this means`}
>{text ?? term}</button>

<style>
  .ex {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    background: none;
    border: 0;
    border-bottom: 1px dotted var(--line-strong);
    border-radius: 0;
    padding: 0 0 1px;
    margin: 0;
    cursor: help;
    text-align: left;
  }
  .ex.inline {
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: none;
    color: inherit;
    cursor: help;
  }
  .ex:hover,
  .ex:focus-visible {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .ex:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }

  /* On paper a dotted underline reads as a defect, and there is no pointer to
     hover with. The word stays; the affordance goes. */
  @media print {
    .ex {
      border-bottom: 0;
      color: inherit;
    }
  }
</style>
