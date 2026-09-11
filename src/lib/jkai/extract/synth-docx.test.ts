// Markdown → Word, asserted on what actually lands in the file.
//
// The bug these exist for: `synthesizeDocx` used to take each token's `.text`,
// which is the RAW MARKDOWN of the paragraph. So `**What they get.**` reached
// Word as four literal asterisks, in every document this module has ever
// produced — the policy assessment's Word export and the education strategy
// brief alike. It looked fine in every code review, because the code reads
// correctly; only opening the file shows it.
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { synthesizeDocx } from './synth-docx';
import { assessmentMarkdown } from '$lib/policy-analysis/report-doc';

/** The document body, as XML — the only place the truth is. */
async function documentXml(markdown: string, title?: string): Promise<string> {
  const { buffer } = await synthesizeDocx(markdown, title);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

/** Visible text, with the markup stripped. */
const plain = (xml: string) => xml.replace(/<[^>]*>/g, '');

describe('inline emphasis is rendered, never passed through', () => {
  it('renders **bold** as a bold run and not as asterisks', async () => {
    const xml = await documentXml('**What they get.** A better reported position.');
    expect(plain(xml)).toContain('What they get.');
    expect(plain(xml)).not.toContain('**');
    expect(xml).toContain('<w:b/>');
  });

  it('renders *italic* without leaking the marker', async () => {
    const xml = await documentXml('Where it says a body *would* act.');
    expect(plain(xml)).toContain('would');
    expect(plain(xml)).not.toMatch(/\*would\*/);
    expect(xml).toContain('<w:i/>');
  });

  it('keeps the surrounding text in the same paragraph', async () => {
    const text = plain(await documentXml('Lead **bold** tail.'));
    expect(text).toContain('Lead');
    expect(text).toContain('bold');
    expect(text).toContain('tail.');
  });

  it('handles emphasis nested inside emphasis', async () => {
    const xml = await documentXml('**bold with *italic* inside**');
    expect(plain(xml)).not.toContain('*');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
  });

  it('renders a bulleted list item with its emphasis, as a real bullet', async () => {
    const xml = await documentXml('- **Answers to.** Ministers, through an annual report.');
    expect(plain(xml)).toContain('Answers to.');
    expect(plain(xml)).not.toContain('**');
    // A numbering reference is what makes it a Word bullet rather than a dash.
    expect(xml).toContain('<w:numPr>');
  });

  it('renders a link as a hyperlink carrying its label', async () => {
    const xml = await documentXml('See [the guidance](https://example.org/g).');
    expect(plain(xml)).toContain('the guidance');
    expect(xml).toContain('<w:hyperlink');
  });

  it('keeps inline code in a monospaced run', async () => {
    const xml = await documentXml('Set `POLICY_ANALYSIS_ENABLED` to 0.');
    expect(plain(xml)).toContain('POLICY_ANALYSIS_ENABLED');
    expect(plain(xml)).not.toContain('`');
    expect(xml).toContain('Courier New');
  });
});

describe('structure survives the crossing', () => {
  it('maps every heading depth to its own Word level', async () => {
    const xml = await documentXml('# One\n\n## Two\n\n### Three\n\n#### Four');
    for (const level of ['Heading1', 'Heading2', 'Heading3', 'Heading4']) {
      expect(xml, level).toContain(level);
    }
  });

  it('renders a heading that carries emphasis as words, not markers', async () => {
    expect(plain(await documentXml('## The **verdict**'))).not.toContain('**');
  });

  it('adds a Title paragraph only when one is asked for', async () => {
    expect(await documentXml('# Body heading', 'A Title')).toContain('Title');
    const untitled = await documentXml('# Body heading');
    expect(plain(untitled)).toContain('Body heading');
    // And the heading is not duplicated when no separate title is passed.
    expect(plain(untitled).match(/Body heading/g)).toHaveLength(1);
  });

  it('flattens a blockquote into its paragraphs rather than dropping it', async () => {
    // The shared copy's "this withholds…" note is a blockquote, and it silently
    // vanished before: nothing in the walk handled the type at all.
    expect(plain(await documentXml('> **This is a shared copy.** It withholds the paper.')))
      .toContain('This is a shared copy.');
  });

  it('keeps every paragraph of a LOOSE list item', async () => {
    // A loose item (blank line between its paragraphs) has several block
    // children; taking only the first dropped the rest silently, in this export
    // and in the education strategy brief that shares this module.
    const text = plain(await documentXml('- First paragraph.\n\n  Second paragraph.\n\n- Another item.'));
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph.');
    expect(text).toContain('Another item.');
  });

  it('carries a code block through as monospaced text', async () => {
    expect(plain(await documentXml('```\nnpm run gate\n```'))).toContain('npm run gate');
  });
});

describe('the policy assessment exports its own key', () => {
  it('renders the definitions appendix with no markup leaking through', async () => {
    // The Word file is the copy that lands on somebody's desk with nobody to
    // ask, so the vocabulary it uses has to be defined IN it. The appendix is
    // the densest markdown this module is asked to render — a heading, a
    // numbered chain and sixty bold-led list items with italics at the end of
    // each — which makes it the case most likely to leak a marker.
    const md = assessmentMarkdown([], { title: 'Appendix check', warnings: [] });
    const xml = await documentXml(md, 'Appendix check');
    const text = plain(xml);

    expect(text).toContain('How to read this assessment');
    expect(text).toContain('How the pieces join');
    // A structure, its plain name leading and the technical word beside it.
    expect(text).toContain('A way to beat the policy');
    expect(text).toContain('(play)');
    // The one measure whose arithmetic a reader has to be able to check.
    expect(text).toContain('geometric mean');
    // And nothing raw. Markers, not em dashes: the copy uses those on purpose.
    expect(text).not.toContain('**');
    expect(text).not.toMatch(/(^|\s)\*\S/);
    expect(text).not.toMatch(/^#+\s/m);
  });
});
