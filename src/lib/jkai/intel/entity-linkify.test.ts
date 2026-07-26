import { describe, it, expect } from 'vitest';
import {
  linkifyEntities,
  anchorsFor,
  isUsableAnchor,
  isAcronymAnchor,
  findAnchor,
  type EntityMentionTarget,
} from './entity-linkify';

function target(id: string, name: string, over: Partial<EntityMentionTarget> = {}): EntityMentionTarget {
  return { id, name, typeName: 'organisation', ...over };
}

describe('isUsableAnchor', () => {
  it('accepts multi-word names', () => {
    expect(isUsableAnchor('IBCA Data Strategy')).toBe(true);
  });

  it('accepts long single words', () => {
    expect(isUsableAnchor('Railpen')).toBe(true);
  });

  it('accepts short acronyms with distinctive case', () => {
    expect(isUsableAnchor('DfE')).toBe(true);
    expect(isUsableAnchor('IBCA')).toBe(true);
  });

  it('rejects common words even when they are real entities', () => {
    // `Beta`, `Alpha` and `Discovery` all exist as entities in production.
    expect(isUsableAnchor('Beta')).toBe(false);
    expect(isUsableAnchor('Alpha')).toBe(false);
    expect(isUsableAnchor('Data')).toBe(false);
  });

  it('rejects very short strings', () => {
    expect(isUsableAnchor('AI')).toBe(false);
  });

  it('rejects short all-lowercase words', () => {
    expect(isUsableAnchor('jen')).toBe(false);
  });
});

describe('isAcronymAnchor', () => {
  it('recognises all-caps acronyms', () => {
    expect(isAcronymAnchor('IBCA')).toBe(true);
    expect(isAcronymAnchor('NCSC')).toBe(true);
  });

  it('rejects ordinary capitalised words', () => {
    expect(isAcronymAnchor('Railpen')).toBe(false);
    expect(isAcronymAnchor('DfE')).toBe(false);
  });
});

describe('findAnchor', () => {
  it('respects word boundaries', () => {
    expect(findAnchor('the reporting line', 'report')).toBe(-1);
    expect(findAnchor('the report line', 'report')).toBe(4);
  });

  it('matches long names case-insensitively', () => {
    expect(findAnchor('the ibca data strategy', 'IBCA Data Strategy')).toBe(4);
  });

  it('requires exact case for acronyms', () => {
    expect(findAnchor('see ibca docs', 'IBCA')).toBe(-1);
    expect(findAnchor('see IBCA docs', 'IBCA')).toBe(4);
  });

  it('finds a later occurrence when the first is not word-bounded', () => {
    expect(findAnchor('IBCAX and IBCA', 'IBCA')).toBe(10);
  });
});

describe('anchorsFor', () => {
  it('puts the longest anchor first', () => {
    const a = anchorsFor(target('1', 'IBCA', { aliases: ['Infected Blood Compensation Authority'] }));
    expect(a[0]).toBe('Infected Blood Compensation Authority');
  });

  it('drops unusable aliases', () => {
    expect(anchorsFor(target('1', 'Railpen', { aliases: ['AI', 'data'] }))).toEqual(['Railpen']);
  });

  it('deduplicates case-insensitively', () => {
    expect(anchorsFor(target('1', 'Railpen', { aliases: ['railpen'] }))).toEqual(['Railpen']);
  });
});

describe('linkifyEntities', () => {
  const entities = [
    target('e1', 'IBCA'),
    target('e2', 'John Kelly', { typeName: 'person' }),
    target('e3', 'IBCA Data Strategy', { typeName: 'project' }),
  ];

  it('links an entity mention in prose', () => {
    const { html, linked } = linkifyEntities('<p>Owned by John Kelly.</p>', entities);
    expect(html).toContain('data-entity-id="e2"');
    expect(html).toContain('>John Kelly</a>');
    expect(linked).toContain('e2');
  });

  it('carries the entity type through for styling', () => {
    const { html } = linkifyEntities('<p>John Kelly leads it.</p>', entities);
    expect(html).toContain('data-entity-type="person"');
  });

  it('prefers the more specific overlapping name', () => {
    const { html, linked } = linkifyEntities('<p>The IBCA Data Strategy matters.</p>', entities);
    expect(html).toContain('>IBCA Data Strategy</a>');
    expect(linked).toContain('e3');
    expect(linked).not.toContain('e1');
  });

  it('links each entity only once per message', () => {
    const { html } = linkifyEntities('<p>IBCA and IBCA again and IBCA.</p>', entities);
    expect(html.match(/data-entity-id="e1"/g)).toHaveLength(1);
  });

  it('links several distinct entities in one sentence', () => {
    const { linked } = linkifyEntities('<p>John Kelly at IBCA.</p>', entities);
    expect(linked.sort()).toEqual(['e1', 'e2']);
  });

  it('never rewrites inside an existing link', () => {
    const html = '<p><a href="/x">John Kelly</a> wrote it.</p>';
    expect(linkifyEntities(html, entities).html).toBe(html);
  });

  it('never rewrites inside code', () => {
    const html = '<p><code>IBCA</code></p>';
    expect(linkifyEntities(html, entities).html).toBe(html);
  });

  it('never rewrites inside a pre block', () => {
    const html = '<pre>const x = "John Kelly";</pre>';
    expect(linkifyEntities(html, entities).html).toBe(html);
  });

  it('leaves tag attributes untouched', () => {
    const html = '<p title="John Kelly">nothing here</p>';
    expect(linkifyEntities(html, entities).html).toBe(html);
  });

  it('does not link a banned common word', () => {
    const { html, linked } = linkifyEntities('<p>The data is fine.</p>', [target('e9', 'Data')]);
    expect(linked).toEqual([]);
    expect(html).not.toContain('entity-mention');
  });

  it('does not fire an acronym on lowercase prose', () => {
    const { linked } = linkifyEntities('<p>the ibca thing</p>', [target('e1', 'IBCA')]);
    expect(linked).toEqual([]);
  });

  it('honours the link ceiling', () => {
    const many = Array.from({ length: 60 }, (_, i) => target(`x${i}`, `Entity Number ${i}`));
    const text = '<p>' + many.map((m) => m.name).join(', ') + '</p>';
    const { linked } = linkifyEntities(text, many, { maxLinks: 5 });
    expect(linked).toHaveLength(5);
  });

  it('returns the input untouched when nothing matches', () => {
    const html = '<p>Entirely unrelated prose.</p>';
    expect(linkifyEntities(html, entities)).toEqual({ html, linked: [] });
  });

  it('handles empty input safely', () => {
    expect(linkifyEntities('', entities)).toEqual({ html: '', linked: [] });
    expect(linkifyEntities('<p>x</p>', [])).toEqual({ html: '<p>x</p>', linked: [] });
  });

  it('escapes anything dangerous in an id', () => {
    const { html } = linkifyEntities('<p>Railpen here</p>', [
      target('a"><script>alert(1)</script>', 'Railpen'),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;');
  });

  it('preserves the matched text exactly as written', () => {
    const { html } = linkifyEntities('<p>the ibca data strategy is live</p>', entities);
    expect(html).toContain('>ibca data strategy</a>');
  });
});
