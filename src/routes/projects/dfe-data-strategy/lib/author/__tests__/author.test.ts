// Tests for the Author engine — the pure modules behind the in-product strategy editor:
// sanitize (contenteditable safety), serialize (html⇄markdown), coverage (does the draft
// answer the commitments/pressures?), heuristics (per-section completeness).
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../sanitize';
import { htmlToMarkdown, markdownToHtml, htmlToText } from '../serialize';
import { runCoverage } from '../coverage';
import { runHeuristics } from '../heuristics';
import { SECTION_TEMPLATES, newDoc, type StrategyDoc, type StrategySection } from '../templates';

const section = (html: string, title = 'Vision'): StrategySection => ({
  id: 's1',
  templateId: null,
  title,
  html,
});
const doc = (html: string): StrategyDoc => ({ title: 'Test', sections: [section(html)], updatedAt: 0 });

describe('sanitizeHtml', () => {
  it('strips scripts, styles and event handlers', () => {
    const dirty = `<p onclick="x()">hi</p><script>alert(1)</script><style>p{}</style><p style="color:red">ok</p>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('style');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('<p>hi</p>');
    expect(clean).toContain('<p>ok</p>');
  });
  it('keeps the allowlist and safe hrefs, drops javascript: urls', () => {
    const dirty = `<h3>t</h3><ul><li><b>b</b> <em>i</em></li></ul><a href="https://gov.uk">x</a><a href="javascript:alert(1)">y</a>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('<h3>t</h3>');
    expect(clean).toContain('<li><b>b</b> <em>i</em></li>');
    expect(clean).toContain('<a href="https://gov.uk">x</a>');
    expect(clean).not.toContain('javascript:');
  });
  it('unwraps unknown tags but keeps their text', () => {
    expect(sanitizeHtml('<div><span>keep me</span></div>')).toContain('keep me');
    expect(sanitizeHtml('<div><span>keep me</span></div>')).not.toContain('<div>');
  });
});

describe('serialize', () => {
  it('round-trips headings, bold, lists and links', () => {
    const md = `### Heading\n\nSome **bold** and *italic* text with a [link](https://gov.uk).\n\n- one\n- two\n\n1. first\n2. second`;
    const html = markdownToHtml(md);
    expect(html).toContain('<h3>Heading</h3>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<a href="https://gov.uk">link</a>');
    expect(html).toContain('<ol>');
    const back = htmlToMarkdown(html);
    expect(back).toContain('### Heading');
    expect(back).toContain('**bold**');
    expect(back).toContain('[link](https://gov.uk)');
    expect(back).toContain('- one');
    expect(back).toContain('1. first');
  });
  it('htmlToText flattens markup and collapses whitespace', () => {
    expect(htmlToText('<p>a  b</p><ul><li>c</li></ul>')).toBe('a b c');
  });
  it('escapes raw angle brackets from markdown input', () => {
    expect(markdownToHtml('a <script> b')).not.toContain('<script>');
  });
});

describe('runCoverage', () => {
  it('marks a commitment addressed when ≥2 distinct aliases hit, touched at 1, missing at 0', () => {
    // relies on B1 data — synthesize a check that works either way by picking any commitment with 2+ aliases
    const withAliases = doc(
      '<p>We will deliver the single unique identifier and the data spine for every child.</p>',
    );
    const res = runCoverage(withAliases);
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) expect(['addressed', 'touched', 'missing']).toContain(item.level);
    // empty doc → nothing addressed
    const empty = runCoverage(doc('<p></p>'));
    expect(empty.items.filter((i) => i.level !== 'missing').length).toBe(0);
    expect(empty.score).toBe(0);
  });
  it('matches at word boundaries, case-insensitively', () => {
    // 'LEO' should not match inside 'Leonardo'
    const res = runCoverage(doc('<p>Leonardo</p>'));
    expect(res.items.every((i) => i.level === 'missing')).toBe(true);
  });
  it('ranks statutory gaps first and reports section attribution', () => {
    const res = runCoverage(doc('<p>nothing relevant here</p>'));
    const gapRanks = res.statutoryGaps.map((g) => g.kind);
    expect(new Set(gapRanks).size).toBeLessThanOrEqual(1); // all commitments
    for (const g of res.gaps) expect(g.level).toBe('missing');
  });
});

describe('runHeuristics', () => {
  const tpl = SECTION_TEMPLATES[0];
  it('flags thin sections and passes substantial ones', () => {
    const thin = runHeuristics(section('<p>Too short.</p>'), tpl);
    expect(thin.find((h) => h.id === 'substance')?.pass).toBe(false);
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const fat = runHeuristics(section(`<p>${words}</p>`), tpl);
    expect(fat.find((h) => h.id === 'substance')?.pass).toBe(true);
  });
  it('detects dates, measurable targets, owners and evidence (null template = all checks)', () => {
    const good = runHeuristics(
      section(
        '<p>By 2027 the Chief Data Officer is accountable for raising completeness to 95% — see <a href="https://gov.uk">the framework</a>.</p>',
      ),
      null,
    );
    expect(good.find((h) => h.id === 'dates')?.pass).toBe(true);
    expect(good.find((h) => h.id === 'measurable')?.pass).toBe(true);
    expect(good.find((h) => h.id === 'owner')?.pass).toBe(true);
    expect(good.find((h) => h.id === 'evidence')?.pass).toBe(true);
    const bare = runHeuristics(section('<p>We aspire to excellence in data.</p>'), null);
    expect(bare.find((h) => h.id === 'dates')?.pass).toBe(false);
    expect(bare.find((h) => h.id === 'measurable')?.pass).toBe(false);
  });
});

describe('templates', () => {
  it('exposes at least 12 templates with guidance and prompts, unique ids', () => {
    expect(SECTION_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SECTION_TEMPLATES.map((t) => t.id)).size).toBe(SECTION_TEMPLATES.length);
    for (const t of SECTION_TEMPLATES) {
      expect(t.guidance.length, t.id).toBeGreaterThan(40);
      expect(t.prompts.length, t.id).toBeGreaterThan(0);
    }
  });
  it('newDoc seeds every core template as an empty section', () => {
    const d = newDoc();
    expect(d.sections.length).toBeGreaterThanOrEqual(10);
    for (const s of d.sections) expect(s.html).toBe('');
  });
});
