import { describe, expect, it } from 'vitest';
import { renderContent, renderArticle } from './renderer';
import { FONT_OPTIONS } from './fonts';

describe('renderContent — markdown', () => {
  it('keeps bullet and numbered lists', () => {
    const out = renderContent('- one\n- two\n\n1. first\n2. second', 'markdown');
    expect(out).toContain('<ul>');
    expect(out).toContain('<ol>');
    expect(out.match(/<li>/g)?.length).toBe(4);
  });

  it('renders an image title as a figcaption', () => {
    const out = renderContent('![alt text](/api/blog/images/1/x.png "The caption")', 'markdown');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>The caption</figcaption>');
    expect(out).toContain('src="/api/blog/images/1/x.png"');
    expect(out).toContain('alt="alt text"');
  });

  it('renders a plain image without a figure', () => {
    const out = renderContent('![alt](/api/blog/images/1/x.png)', 'markdown');
    expect(out).toContain('<img');
    expect(out).not.toContain('<figure>');
  });
});

describe('renderContent — sanitizer', () => {
  it('keeps a same-origin /projects/ iframe embed', () => {
    const html =
      '<figure class="project-embed"><iframe src="/projects/terminal-descent" title="Terminal Descent" loading="lazy" allowfullscreen="true"></iframe>' +
      '<figcaption><a href="/projects/terminal-descent" target="_blank" rel="noopener noreferrer">Terminal Descent — open full page ↗</a></figcaption></figure>';
    const out = renderContent(html, 'html');
    expect(out).toContain('<iframe src="/projects/terminal-descent"');
    expect(out).toContain('class="project-embed"');
    expect(out).toContain('figcaption');
  });

  it('drops iframes pointing at other relative paths', () => {
    const out = renderContent('<p>hi</p><iframe src="/admin"></iframe>', 'html');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('<p>hi</p>');
  });

  it('drops external iframes not on the allow-list, tag and all', () => {
    const out = renderContent('<iframe src="https://evil.example.com/x"></iframe>', 'html');
    expect(out).not.toContain('<iframe');
  });

  it('still allows YouTube iframes', () => {
    const out = renderContent('<iframe src="https://www.youtube.com/embed/abc"></iframe>', 'html');
    expect(out).toContain('<iframe src="https://www.youtube.com/embed/abc"');
  });

  it('keeps site font-family tokens and strips arbitrary fonts', () => {
    const kept = renderContent('<p><span style="font-family: var(--font-mono)">code-ish</span></p>', 'html');
    expect(kept).toContain('font-family:var(--font-mono)');
    const stripped = renderContent('<p><span style="font-family: Comic Sans MS">nope</span></p>', 'html');
    expect(stripped).not.toContain('Comic Sans');
  });

  // The allow-list is derived from $lib/blog/fonts, so this is the assertion
  // that the derivation actually reaches the sanitiser. Mutate FONT_OPTIONS to
  // drop 'read' and this fails — which is the point: a green test over an
  // allow-list that was written out twice proves only that both copies agree
  // today.
  it('admits every face the picker offers, and only those', () => {
    for (const opt of FONT_OPTIONS) {
      const out = renderContent(`<p><span style="font-family: ${opt.cssVar}">x</span></p>`, 'html');
      expect(out, `picker offers ${opt.key} but the sanitiser strips it`).toContain(
        `font-family:${opt.cssVar.replace(/\s+/g, '')}`,
      );
    }
    // A token that exists in app.css but is NOT in the vocabulary must still be
    // refused — the allow-list is the picker's vocabulary, not "any --font-*".
    const off = renderContent('<p><span style="font-family: var(--font-code)">x</span></p>', 'html');
    expect(off).not.toContain('--font-code');
  });

  // --font-sans is an alias of --font-body in app.css and appears in posts
  // written before the vocabulary module existed. Dropping it would silently
  // strip the font off already-published prose.
  it('still admits the legacy --font-sans alias', () => {
    const out = renderContent('<p><span style="font-family: var(--font-sans)">x</span></p>', 'html');
    expect(out).toContain('font-family:var(--font-sans)');
  });

  it('keeps font-size steps', () => {
    const out = renderContent('<p><span style="font-size: 1.25em">big</span></p>', 'html');
    expect(out).toContain('font-size:1.25em');
  });

  it('keeps captioned image figures', () => {
    const out = renderContent('<figure><img src="/api/blog/images/1/s.png" alt="a"><figcaption>Shot</figcaption></figure>', 'html');
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>Shot</figcaption>');
  });
});

describe('renderArticle — anchors and outline', () => {
  it('anchors h2/h3 and returns them in document order', () => {
    const { html, toc } = renderArticle(
      '<h2>First Section</h2><p>a</p><h3>A Detail</h3><p>b</p><h2>Second</h2>',
      'html',
    );
    expect(toc).toEqual([
      { id: 'h-first-section', text: 'First Section', level: 2 },
      { id: 'h-a-detail', text: 'A Detail', level: 3 },
      { id: 'h-second', text: 'Second', level: 2 },
    ]);
    expect(html).toContain('<h2 id="h-first-section">');
    expect(html).toContain('<h3 id="h-a-detail">');
  });

  it('de-duplicates repeated headings so both stay linkable', () => {
    const { toc } = renderArticle('<h2>Notes</h2><h2>Notes</h2>', 'html');
    expect(toc.map((t) => t.id)).toEqual(['h-notes', 'h-notes-2']);
  });

  // Author-supplied ids are the hole this closes: headings have no attribute
  // allow-list entry, so an id in the source must never survive to the output.
  it('never carries an author-supplied id through', () => {
    const { html, toc } = renderArticle('<h2 id="main-nav">Hijack</h2>', 'html');
    expect(html).not.toContain('main-nav');
    expect(toc[0].id).toBe('h-hijack');
  });

  it('strips markup inside a heading when building the outline text', () => {
    const { toc } = renderArticle('<h2>The <em>real</em> cost</h2>', 'html');
    expect(toc[0].text).toBe('The real cost');
  });

  it('leaves an empty heading unanchored rather than linking to a blank row', () => {
    const { html, toc } = renderArticle('<h2></h2><h2>Real</h2>', 'html');
    expect(toc).toHaveLength(1);
    expect(html).toContain('<h2></h2>');
  });

  it('h1 and h4 are not outline material', () => {
    const { toc } = renderArticle('<h1>Title</h1><h4>Aside</h4><h2>Body</h2>', 'html');
    expect(toc.map((t) => t.text)).toEqual(['Body']);
  });

  it('builds an outline from markdown headings too', () => {
    const { toc } = renderArticle('## From Markdown\n\ntext\n', 'markdown');
    expect(toc).toEqual([{ id: 'h-from-markdown', text: 'From Markdown', level: 2 }]);
  });
});

describe('renderContent — editorial furniture', () => {
  it('keeps a pull quote and a callout, and drops an unknown aside class', () => {
    expect(renderContent('<aside class="pull-quote">Big</aside>', 'html')).toContain('class="pull-quote"');
    expect(renderContent('<aside class="callout-warn">Careful</aside>', 'html')).toContain('class="callout-warn"');
    const odd = renderContent('<aside class="position-fixed-overlay">x</aside>', 'html');
    expect(odd).toContain('<aside>');
    expect(odd).not.toContain('position-fixed-overlay');
  });

  it('keeps bleed and alignment classes on a figure but not arbitrary ones', () => {
    expect(renderContent('<figure class="bleed"><img src="/a.png" alt="a"></figure>', 'html')).toContain('class="bleed"');
    const odd = renderContent('<figure class="evil"><img src="/a.png" alt="a"></figure>', 'html');
    expect(odd).not.toContain('evil');
  });

  // The tag was allowed from the start; every attribute that made it a video
  // was not, so a published <video> was reduced to an empty element.
  it('keeps the attributes that make a video a video', () => {
    const out = renderContent(
      '<video src="/api/blog/images/1/clip.mp4" controls muted playsinline poster="/p.jpg"></video>',
      'html',
    );
    expect(out).toContain('src="/api/blog/images/1/clip.mp4"');
    expect(out).toContain('controls');
    expect(out).toContain('poster="/p.jpg"');
  });

  it('does not admit autoplay', () => {
    const out = renderContent('<video src="/a.mp4" autoplay controls></video>', 'html');
    expect(out).not.toContain('autoplay');
    expect(out).toContain('controls');
  });

  it('keeps a sidenote span pair', () => {
    const out = renderContent('<p>x<span class="sidenote"><span class="sidenote-body">note</span></span></p>', 'html');
    expect(out).toContain('class="sidenote"');
    expect(out).toContain('class="sidenote-body"');
  });
});

// The editorial capabilities added 2026-09-04. `rich-editor.editor.test.ts`
// holds the editor half of each of these; a green test over either alone is a
// green test over a feature that does not work.
describe('editorial furniture survives the sanitiser', () => {
  it('keeps a key-point callout', () => {
    const out = renderContent('<aside class="callout-key"><p>The point.</p></aside>', 'html');
    expect(out).toContain('class="callout-key"');
    expect(out).toContain('The point.');
  });

  it('keeps a standfirst', () => {
    const out = renderContent('<aside class="standfirst">The intro.</aside>', 'html');
    expect(out).toContain('class="standfirst"');
  });

  it.each(['hl', 'hl-warm', 'hl-cool'])('keeps a %s highlight', (cls) => {
    const out = renderContent(`<p>a <mark class="${cls}">phrase</mark> here</p>`, 'html');
    expect(out).toContain(`<mark class="${cls}">`);
  });

  it('drops a class nobody declared, leaving the element plain', () => {
    const out = renderContent('<aside class="callout-nonsense"><p>x</p></aside>', 'html');
    expect(out).not.toContain('callout-nonsense');
    expect(out).toContain('<aside>');
  });

  it('keeps a highlight readable when it wraps a link', () => {
    const out = renderContent('<p><mark class="hl"><a href="https://ons.gov.uk/a">source</a></mark></p>', 'html');
    expect(out).toContain('<mark class="hl">');
    expect(out).toContain('href="https://ons.gov.uk/a"');
  });
});

describe('renderArticle lifts sources out of the reading column', () => {
  const BODY = '<h2>A section</h2><p>Some prose.</p>';

  it('returns null references for a post that cites nothing', () => {
    expect(renderArticle(BODY, 'html').references).toBeNull();
  });

  it('returns the block separately and removes it from the article html', () => {
    const withRefs =
      BODY +
      '<section class="references"><ol class="footnotes">' +
      '<li id="fn-1">ONS — <a href="https://ons.gov.uk/a">https://ons.gov.uk/a</a></li>' +
      '</ol></section>';
    const article = renderArticle(withRefs, 'html');
    expect(article.references).toContain('ons.gov.uk');
    expect(article.html).not.toContain('ons.gov.uk');
    expect(article.html).toContain('Some prose.');
  });

  // A legacy post carries its list behind a literal <h3>Sources</h3>. Left in
  // the body that heading is anchored and lands in the contents rail as though
  // it were a section of the argument.
  it('keeps a legacy Sources heading out of the outline', () => {
    const legacy =
      BODY +
      '<hr><h3>Sources</h3><ol class="footnotes">' +
      '<li id="fn-1">BBC — <a href="https://bbc.co.uk/a">https://bbc.co.uk/a</a></li>' +
      '</ol>';
    const article = renderArticle(legacy, 'html');
    expect(article.toc.map((t) => t.text)).toEqual(['A section']);
    expect(article.references).toContain('bbc.co.uk');
    expect(article.html).not.toContain('Sources');
  });
});
