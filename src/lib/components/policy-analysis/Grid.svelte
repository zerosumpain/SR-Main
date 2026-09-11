<script lang="ts">
  // THE GRID PRIMITIVE — one table shape, used by the cast, the playbook and the
  // adjacency map.
  //
  // Three panels were three walls of cards and are now three tables, so the
  // table itself is a component rather than three near-copies. What it owns:
  //
  //  * a sticky header row AND a sticky first column, both on an OPAQUE ground
  //    (`--surface-elevated`) — `--card-bg` is a 7% tint and a sticky cell
  //    painted with it lets the rows slide visibly underneath;
  //  * `table-layout: fixed` plus a `<colgroup>`, which is the repo's rule for
  //    any table that has to hold its columns still while cells clip;
  //  * horizontal scroll on the WRAPPER, never the page — `overflow-x: auto`
  //    clips both axes, so nothing inside may rely on overflowing vertically
  //    (that is why the hover card is portalled, mounted once, by the page);
  //  * a print rule that drops the stickiness, because a sticky cell on paper
  //    prints once at the top and leaves the rest of the table unlabelled.
  //
  // Everything else — what a cell contains, what it opens — is the caller's,
  // passed as a snippet per column. The grid never knows what a play is.
  import type { Snippet } from 'svelte';

  interface Props {
    /** Column definitions. `width` is a CSS length for the `<colgroup>`. */
    columns: { key: string; head: string; width?: string; term?: string; align?: 'left' | 'right' | 'center'; note?: string }[];
    /** Rows, opaque to the grid. */
    rows: unknown[];
    /** Stable key per row. */
    id: (row: unknown) => string;
    /** The cell renderer, called per row per column. */
    cell: Snippet<[unknown, { key: string; head: string }]>;
    /** Rendered in the header cells instead of plain text — used for explainers. */
    head?: Snippet<[{ key: string; head: string; term?: string; note?: string }]>;
    /** A caption that reads as the table's own sentence. Always rendered. */
    caption: string;
    /** Freeze the first column as a row header. */
    stickyFirst?: boolean;
    /** What to say when `rows` is empty — a table with no rows must explain itself. */
    empty?: string;
  }

  let {
    columns,
    rows,
    id,
    cell,
    head,
    caption,
    stickyFirst = true,
    empty = 'Nothing to show here yet.',
  }: Props = $props();
</script>

{#if rows.length}
  <div class="g-wrap">
    <table class="g" class:sticky-first={stickyFirst}>
      <caption>{caption}</caption>
      <colgroup>
        {#each columns as column (column.key)}
          <col style={column.width ? `width: ${column.width}` : undefined} />
        {/each}
      </colgroup>
      <thead>
        <tr>
          {#each columns as column (column.key)}
            <th scope="col" class={`al-${column.align ?? 'left'}`}>
              {#if head}{@render head(column)}{:else}{column.head}{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (id(row))}
          <tr>
            {#each columns as column, ci (column.key)}
              {#if ci === 0 && stickyFirst}
                <th scope="row" class={`al-${column.align ?? 'left'}`}>{@render cell(row, column)}</th>
              {:else}
                <td class={`al-${column.align ?? 'left'}`}>{@render cell(row, column)}</td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <p class="g-empty">{empty}</p>
{/if}

<style>
  /* The scroll lives here and nowhere else. A grid wider than the column is the
     normal case on a laptop, and the page must not scroll sideways for it. */
  .g-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-strong);
    margin-top: clamp(14px, 1.8vw, 20px);
  }

  .g {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-size: var(--fs-body-sm);
  }

  /* The caption is the table's sentence, and it is the one thing a screen
     reader hears first. Visible, because a reader who cannot see the caption
     cannot see why these columns are beside each other. */
  caption {
    caption-side: top;
    text-align: left;
    padding: 10px 12px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--line-strong);
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    /* OPAQUE. A sticky header on a translucent tint shows the rows through it. */
    background: var(--surface-elevated);
    border-bottom: 2px solid var(--text-primary);
    padding: 8px 12px;
    text-align: left;
    vertical-align: bottom;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }

  tbody th,
  tbody td {
    /* 7px, not 9. Nine rows of a six-column grid pay this four times over, and
       the cells already carry their own leading. */
    padding: 7px 12px;
    border-bottom: 1px solid var(--line-hair);
    vertical-align: top;
    text-align: left;
    font-weight: 400;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  tbody tr:hover th,
  tbody tr:hover td {
    background: var(--surface-sunken);
  }

  .sticky-first tbody th:first-child,
  .sticky-first thead th:first-child {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--surface-elevated);
    border-right: 1px solid var(--line-strong);
  }
  .sticky-first thead th:first-child {
    z-index: 3;
  }
  /* The hover tint has to reach the frozen cell too, or the row appears to end
     at the freeze line. */
  .sticky-first tbody tr:hover th:first-child {
    background: color-mix(in oklab, var(--surface-elevated) 80%, var(--accent) 8%);
  }

  /* A numeric column reads right-aligned with tabular figures, so the digits
     line up down the column and the eye can compare them without reading. */
  .al-right {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .al-center {
    text-align: center;
  }

  .g-empty {
    margin: 1rem 0 0;
    padding: 0.9rem 1rem;
    border-left: 3px solid var(--line-strong);
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
  }

  /*
   * PRINT. Stickiness is a screen affordance: on paper a sticky header prints
   * in its scroll position once and every page after it is an unlabelled grid.
   * The repeating `<thead>` a printer does for a plain table is the right
   * behaviour, so the position is dropped rather than kept.
   */
  @media print {
    .g-wrap {
      overflow: visible;
      border-color: #000;
    }
    thead th,
    .sticky-first tbody th:first-child,
    .sticky-first thead th:first-child {
      position: static;
      background: #fff;
    }
    thead {
      display: table-header-group;
    }
    tbody tr {
      break-inside: avoid;
    }
    caption {
      background: none;
      color: #000;
    }
  }
</style>
