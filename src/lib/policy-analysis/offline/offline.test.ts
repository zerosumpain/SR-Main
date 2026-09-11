// THE OFFLINE PACK — the properties that make a file readable with no network.
//
// Every one of these is cheap to assert and expensive to discover by hand: a
// pack whose fonts fall back, whose data island closes early, or which quietly
// reaches for a CDN looks correct until somebody opens it on a train.
import { describe, expect, it } from 'vitest';
import { artefact, STAGES } from '../contracts';
import { shareableReport } from '../share';
import { ownerPayload, sharedPayload, PAYLOAD_VERSION } from './payload';
import { embedJson, escapeHtml, fontFaceCss, offlineHtml, stripUnresolvableFonts } from './html';
import { filenameFromDisposition } from './download';

const passage = artefact('passage_0001', 'passage', 'Page 1', 'The Council is accountable for delivery.', { documentHash: 'a'.repeat(64) }, { origin: 'extracted_fact' });
const claim = artefact('s1_0_claim', 'claim', 'Accountability', 'The Council is accountable.', { category: 'responsibility', notes: 'x' },
  { refs: ['passage_0001'], origin: 'extracted_fact', sourceId: 'passage_0001', sourceQuote: 'The Council is accountable', page: 4, section: 'Delivery' });
const cross = artefact('s11_0_x', 'cross_policy', 'Two policies, one body', 'x', {
  pattern: 'common_actor_overload', otherAnalysisId: 'abc', otherAnalysisTitle: 'A DIFFERENT PRIVATE PAPER',
  otherArtefactIds: [], actorId: null, interaction: 'x', consequence: 'x', severity: 0.5, evidenceLimits: 'x', action: 'x',
}, {});

const stages = STAGES.map((name, ordinal) => ({ ordinal, name, warnings: [`warning from ${name}`] }));
const meta = {
  title: 'A policy — “draft” v2',
  jurisdiction: 'England',
  policyArea: 'Housing',
  status: 'completed',
  completedAt: '2026-09-09T10:00:00.000Z',
};

const shell = { js: 'void 0;', css: 'body{color:#000}', fontCss: "@font-face{src:url(data:font/woff2;base64,AAA)}" };

describe('what a pack carries', () => {
  it('gives the owner the policy document, because that is what an offline copy is for', () => {
    const pack = ownerPayload({ ...meta, documentSha256: 'b'.repeat(64), artefacts: [passage, claim, cross], stages });
    expect(pack.artefacts.map((a) => a.kind)).toContain('passage');
    expect(pack.scope).toBe('owner');
    expect(pack.documentSha256).toBe('b'.repeat(64));
    expect(pack.version).toBe(PAYLOAD_VERSION);
  });

  it('carries neither the document nor the reader’s other assessments in a shared pack', () => {
    // The redaction is `share.ts`'s, not this module's. What is asserted here is
    // the PROPERTY on the finished pack, which holds whoever produced it.
    const report = shareableReport({ artefacts: [passage, claim, cross], stages });
    const pack = sharedPayload({ ...meta, ...report });
    const kinds = pack.artefacts.map((a) => a.kind);
    expect(kinds).not.toContain('passage');
    expect(kinds).not.toContain('cross_policy');
    expect(JSON.stringify(pack)).not.toContain('A DIFFERENT PRIVATE PAPER');
    expect(pack.withheld.map((w) => w.kind).sort()).toEqual(['cross_policy', 'passage']);
  });

  it('withholds the source digest from a shared pack, because a hash is a confirmation oracle', () => {
    const report = shareableReport({ artefacts: [passage, claim], stages });
    expect(sharedPayload({ ...meta, ...report }).documentSha256).toBeNull();
  });
});

describe('the data island cannot be closed from inside', () => {
  it('escapes a policy paper that contains the characters of a closing script tag', () => {
    const embedded = embedJson({ statement: 'the guidance said </script><img src=x> and then stopped' });
    expect(embedded).not.toContain('</script');
    expect(JSON.parse(embedded).statement).toContain('</script>');
  });

  it('escapes the line separators a PDF extractor produces', () => {
    const embedded = embedJson({ statement: 'one\u2028two\u2029three' });
    expect(embedded).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(embedded).statement).toBe('one\u2028two\u2029three');
  });

  it('escapes a title bound for markup rather than for JSON', () => {
    expect(escapeHtml('<b>"x" & y</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;');
  });
});

describe('the page reaches for nothing', () => {
  const html = offlineHtml(ownerPayload({ ...meta, artefacts: [passage, claim], stages }), shell);

  it('loads no script or stylesheet from anywhere', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });

  it('carries no absolute URL in any position that would fetch one', () => {
    // Prose may mention a domain; `src=`, `href=` and `url()` may not.
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/url\(\s*["']?https?:/i);
  });

  it('names the assessment in the title, because the pack lives in a downloads folder', () => {
    expect(html).toContain(escapeHtml(`${meta.title} — policy assessment`));
  });

  it('says what to do when scripting is off rather than showing a blank page', () => {
    expect(html).toContain('<noscript>');
    expect(html).toContain('report.docx');
  });
});

describe('the fonts travel with the pack', () => {
  it('embeds a face as a data URI', () => {
    const css = fontFaceCss([{ family: 'Archivo Black', weight: '400', base64: 'AAAA' }]);
    expect(css).toContain("font-family:'Archivo Black'");
    expect(css).toContain('url(data:font/woff2;base64,AAAA)');
  });

  it('drops a face whose file the pack does not carry, and keeps one it does', () => {
    const css = stripUnresolvableFonts(
      "@font-face{font-family:'Selawik';src:url('/fonts/selawik/selawik-regular.woff2') format('woff2');}" +
        "@font-face{font-family:'DM Sans';src:url(data:font/woff2;base64,AAA) format('woff2');}" +
        'body{color:red}',
    );
    expect(css).not.toContain('Selawik');
    expect(css).toContain('DM Sans');
    expect(css).toContain('body{color:red}');
  });
});

describe('the browser saves the file under the name the server chose', () => {
  it('reads the RFC 5987 form, which is the one a prose title needs', () => {
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''${encodeURIComponent('a policy — draft-2026-09-11.zip')}`))
      .toBe('a policy — draft-2026-09-11.zip');
  });

  it('falls back to the plain parameter, and to null when there is nothing to read', () => {
    expect(filenameFromDisposition('attachment; filename="report.docx"')).toBe('report.docx');
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
  });

  it('never returns a path, because `a.download` is a filesystem write', () => {
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''${encodeURIComponent('/tmp/x.zip')}`)).toBe('x.zip');
  });
});
