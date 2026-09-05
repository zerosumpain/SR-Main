// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { hardenDiagramSvg } from '$lib/jkai/artifacts/diagram-svg';

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

describe('hardenDiagramSvg', () => {
  it('drops an embedded image, which mermaid permits and the chat does not', () => {
    const out = hardenDiagramSvg(wrap('<image href="https://elsewhere/p.gif"/><path d="M0 0"/>'));
    expect(out).not.toContain('elsewhere');
    expect(out).toContain('<path');
  });

  it('drops foreignObject, which can carry arbitrary HTML', () => {
    const out = hardenDiagramSvg(wrap('<foreignObject><b>hi</b></foreignObject><path d="M0 0"/>'));
    expect(out.toLowerCase()).not.toContain('foreignobject');
    expect(out).toContain('<path');
  });

  it('keeps <use>, which draws mermaid arrowheads', () => {
    const out = hardenDiagramSvg(wrap('<defs><marker id="a"/></defs><use href="#a"/>'));
    expect(out).toContain('use');
    expect(out).toContain('#a');
  });

  it('strips a link that leaves the document but keeps a fragment', () => {
    const out = hardenDiagramSvg(wrap('<a href="https://evil/x">t</a><use href="#ok"/>'));
    expect(out).not.toContain('evil');
    expect(out).toContain('#ok');
  });

  it('returns empty for source that does not parse, rather than passing it through', () => {
    expect(hardenDiagramSvg('<svg><unclosed>')).toBe('');
  });

  it('fails closed where there is no parser to vouch for the markup', () => {
    const saved = globalThis.DOMParser;
    // @ts-expect-error — deliberately removing the global for this assertion.
    delete globalThis.DOMParser;
    try {
      expect(hardenDiagramSvg(wrap('<path d="M0 0"/>'))).toBe('');
    } finally {
      globalThis.DOMParser = saved;
    }
  });
});
