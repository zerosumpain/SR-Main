<script lang="ts">
  // THE KEY: every structure, every measure, every formula, in one visible place.
  //
  // The explainers shipped on 2026-09-10 were all hover-only — `ExplainLabel` on
  // a column header, a peek card on a figure. That answers "what is THIS column"
  // for a reader who already suspected there was something to ask, and answers
  // nothing at all for the reader who opens the page cold and finds a table of
  // bodies scored on "concealment". There was no page that said what a play IS.
  //
  // So this is a document, not a tooltip: a reading chain that says how the
  // pieces join, then the sixteen structures, then every measure with its
  // arithmetic written out. It renders inline as a workspace rather than in a
  // modal, because it must PRINT — an exported assessment that uses this
  // vocabulary has to define it, or the Word file lands on a desk with nobody to
  // ask. `report-doc.ts` renders the same content into the export.
  //
  // Nothing here takes an artefact: it is the same key for every assessment, so
  // it is a pure read of `glossary.ts`.
  import { KEY_SECTIONS, READING_CHAIN } from '$lib/policy-analysis/glossary';

  /** Collapse the long structure list on first view; print opens everything. */
  let openSection = $state<string | null>(KEY_SECTIONS[0]?.title ?? null);
</script>

<div class="kp">
  <section class="kp-chain" aria-labelledby="kp-chain-h">
    <h3 id="kp-chain-h">How the pieces join</h3>
    <p class="kp-blurb">
      Everything on this page is downstream of the paper itself. Reading the chain is also how you read
      what a number is allowed to mean: a play cannot exist without a body, a body cannot exist without a
      passage that names it, and a conclusion citing none of it is one the assessment throws away.
    </p>
    <ol class="kp-steps">
      {#each READING_CHAIN as link, i (link.step)}
        <li>
          <span class="kp-step-no">{String(i + 1).padStart(2, '0')}</span>
          <span class="kp-step-name">{link.step}</span>
          <span class="kp-step-then">{link.then}</span>
        </li>
      {/each}
    </ol>
  </section>

  {#each KEY_SECTIONS as section (section.title)}
    <section class="kp-sec" class:open={openSection === section.title} aria-labelledby={`kp-${section.title}`}>
      <!-- A heading that is also the control. On paper the button is stripped to
           text by the page's print rules and every section is open. -->
      <h3 id={`kp-${section.title}`}>
        <button
          type="button"
          class="kp-toggle"
          aria-expanded={openSection === section.title}
          onclick={() => (openSection = openSection === section.title ? null : section.title)}
        >
          <span class="kp-toggle-mark" aria-hidden="true">{openSection === section.title ? '–' : '+'}</span>
          {section.title}
          <span class="kp-count">{section.terms.length}</span>
        </button>
      </h3>
      <p class="kp-blurb">{section.blurb}</p>

      <dl class="kp-terms">
        {#each section.terms as t (t.key)}
          <div class="kp-term">
            <dt>
              <span class="kp-plain">{t.plain ?? t.label}</span>
              {#if t.plain && t.plain !== t.label}<span class="kp-formal">{t.label}</span>{/if}
            </dt>
            <dd>
              <p class="kp-what">{t.what}</p>
              <p class="kp-why"><span class="kp-tag">Why it is here</span> {t.why}</p>
              <p class="kp-read"><span class="kp-tag">How to read it</span> {t.read}</p>
              {#if t.formula}
                <p class="kp-formula"><span class="kp-tag">How it is worked out</span> {t.formula}</p>
              {/if}
              <p class="kp-prov">{t.provenance}</p>
            </dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}
</div>

<style>
  .kp {
    margin-top: clamp(20px, 2.5vw, 30px);
  }

  /* ——— the chain ——————————————————————————————————————————— */
  .kp-chain {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent);
    padding: clamp(16px, 2vw, 24px);
    margin-bottom: clamp(22px, 3vw, 34px);
  }
  .kp-steps {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    gap: 1px;
    background: var(--line-hair);
  }
  .kp-steps li {
    display: grid;
    grid-template-columns: 2.4rem minmax(9rem, 14rem) minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    background: var(--bg);
    padding: 8px 0;
  }
  .kp-step-no {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .kp-step-name {
    font-weight: 600;
    font-size: var(--fs-body-sm);
  }
  .kp-step-then {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 70ch;
  }

  /* ——— the sections ————————————————————————————————————————— */
  .kp-sec {
    border-top: 1px solid var(--line-strong);
    padding-top: 12px;
    margin-top: 12px;
  }
  .kp-sec h3 {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body);
  }
  .kp-toggle {
    font: inherit;
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 4px 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .kp-toggle:hover {
    color: var(--accent);
  }
  .kp-toggle-mark {
    font-family: var(--font-mono);
    color: var(--accent);
    width: 1ch;
  }
  .kp-count {
    margin-left: auto;
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .kp-blurb {
    margin: 6px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 82ch;
  }

  .kp-terms {
    display: none;
    margin: 16px 0 8px;
  }
  .kp-sec.open .kp-terms {
    display: grid;
    gap: 1px;
    background: var(--line-hair);
  }
  .kp-term {
    display: grid;
    grid-template-columns: minmax(11rem, 15rem) minmax(0, 1fr);
    gap: 18px;
    background: var(--bg);
    padding: 12px 0;
  }
  .kp-term dt {
    min-width: 0;
  }
  .kp-plain {
    display: block;
    font-weight: 600;
    font-size: var(--fs-body-sm);
    line-height: 1.3;
  }
  /* The technical word stays visible beside the plain one: a reader who meets
     "concealment" in an exported table needs to have seen it here, not to have
     been protected from it. */
  .kp-formal {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .kp-term dd {
    margin: 0;
    min-width: 0;
  }
  .kp-term p {
    margin: 0 0 5px;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    max-width: 84ch;
  }
  .kp-what {
    color: var(--text-primary);
  }
  .kp-why,
  .kp-read,
  .kp-formula {
    color: var(--text-secondary);
  }
  .kp-formula {
    border-left: 2px solid var(--accent-ink);
    padding-left: 10px;
  }
  .kp-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: 6px;
  }
  .kp-prov {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin-top: 6px;
  }

  @media (max-width: 720px) {
    .kp-steps li,
    .kp-term {
      grid-template-columns: minmax(0, 1fr);
      gap: 4px;
    }
    .kp-step-no {
      display: none;
    }
  }

  /*
   * PRINT. The key is the appendix of the printed pack, so every section opens
   * and the toggles become plain headings. A definition behind a collapsed
   * disclosure would be a definition the PDF does not contain.
   */
  @media print {
    .kp-terms,
    .kp-sec.open .kp-terms {
      display: block;
      background: none;
    }
    .kp-term {
      break-inside: avoid;
      border-bottom: 1px solid #ccc;
    }
    .kp-toggle-mark,
    .kp-count {
      display: none !important;
    }
    .kp-chain {
      border-color: #000;
      break-inside: avoid;
    }
  }
</style>
