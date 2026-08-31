import { describe, expect, it } from 'vitest';
import { MAX_CARD_CHARS, actionCard, noteCard, weaveHash, weaveText } from './cards';

const note = {
  id: 'n1',
  title: 'Boiler replacement',
  body: 'The old one is 14 years old. Worth pricing a heat pump against a like-for-like swap.',
  folder: 'House',
  supporting: 'Heat pumps qualify for the Boiler Upgrade Scheme grant.',
};

describe('noteCard', () => {
  it('carries the note verbatim, with its title and folder', () => {
    const c = noteCard(note);
    expect(c.key).toBe('note:n1');
    expect(c.text).toContain('[House]');
    expect(c.text).toContain('"Boiler replacement"');
    expect(c.text).toContain('14 years old');
  });

  it('EXCLUDES supporting — the engine must not cite its own earlier output', () => {
    expect(noteCard(note).text).not.toContain('Boiler Upgrade Scheme');
  });

  it('caps a long draft so one note cannot crowd out the pack', () => {
    const c = noteCard({ ...note, body: 'y'.repeat(5_000) });
    expect(c.text.length).toBeLessThan(MAX_CARD_CHARS + 120);
  });

  it('names an untitled note rather than printing an empty quote', () => {
    expect(noteCard({ ...note, title: '   ' }).text).toContain('(untitled note)');
  });

  it('omits the folder entirely when there is none', () => {
    expect(noteCard({ ...note, folder: '' }).text).not.toContain('[]');
  });
});

describe('actionCard — what stops the loop repeating itself', () => {
  it('states the outcome as a fact, with its reference', () => {
    const c = actionCard({
      id: 'a1',
      noteTitle: 'Boiler replacement',
      kind: 'research',
      title: 'Heat pump costs',
      result: 'Typical install is £7-13k before grant.',
      refKind: 'research',
      refId: 'r9',
    });
    expect(c.key).toBe('note-action:a1');
    expect(c.text).toContain('Already done');
    expect(c.text).toContain('(research:r9)');
    expect(c.text).toContain('£7-13k');
  });

  it('reads sensibly with no result and no reference', () => {
    const c = actionCard({ id: 'a2', noteTitle: '', kind: 'context', title: 'Added background', result: null, refKind: null, refId: null });
    expect(c.text).toContain('untitled');
    expect(c.text).not.toContain('null');
    expect(c.text).not.toContain('()');
  });
});

describe('weaveText', () => {
  it('INCLUDES supporting — the graph wants every name, unlike the pack', () => {
    const t = weaveText(note);
    expect(t).toContain('Boiler Upgrade Scheme');
    expect(t).toContain('Folder: House');
  });

  it('leaves no blank sections when the optional parts are absent', () => {
    const t = weaveText({ ...note, folder: '', supporting: null });
    expect(t).not.toMatch(/\n{3,}/);
    expect(t.trim()).toBe(t);
    expect(t).not.toContain('Supporting notes');
  });
});

describe('weaveHash', () => {
  it('is stable, short, and moves when the text does', () => {
    expect(weaveHash('a')).toBe(weaveHash('a'));
    expect(weaveHash('a')).toHaveLength(32);
    expect(weaveHash(weaveText(note))).not.toBe(weaveHash(weaveText({ ...note, body: 'changed' })));
  });
});
