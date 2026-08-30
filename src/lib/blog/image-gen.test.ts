import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ASPECT,
  DEFAULT_STYLE,
  IMAGE_ASPECTS,
  IMAGE_STYLES,
  MAX_SUBJECT_LENGTH,
  cleanBrief,
  composePrompt,
  findStyle,
  isAspect,
} from './image-gen';

describe('the style vocabulary', () => {
  it('has unique keys and a resolvable default', () => {
    const keys = IMAGE_STYLES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(DEFAULT_STYLE);
  });

  it('offers the three themes the brief named', () => {
    const keys = IMAGE_STYLES.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['tilt-shift', 'photoreal', 'animation']));
  });

  // Every fragment must forbid text. Image models put garbled lettering into
  // anything that looks like a poster or a sign unless told not to, and a cover
  // with fake words on it is unusable rather than merely imperfect.
  it('forbids text in every style', () => {
    for (const style of IMAGE_STYLES) {
      expect(style.fragment.toLowerCase(), style.key).toMatch(/no (?:readable )?text/);
    }
  });

  it('gives every style a label and a hint for the picker', () => {
    for (const style of IMAGE_STYLES) {
      expect(style.label.length, style.key).toBeGreaterThan(2);
      expect(style.hint.length, style.key).toBeGreaterThan(10);
      expect(style.fragment.length, style.key).toBeGreaterThan(60);
    }
  });
});

describe('findStyle', () => {
  it('resolves a known key', () => {
    expect(findStyle('tilt-shift').label).toBe('Tilt-shift');
  });

  // On the generation path. Refusing to draw because a stale key arrived from
  // an old tab is worse than drawing in the house style.
  it('falls back to the default rather than throwing', () => {
    for (const bad of ['nope', '', null, undefined, 42, {}]) {
      expect(findStyle(bad).key).toBe(DEFAULT_STYLE);
    }
  });
});

describe('isAspect', () => {
  it('accepts the supported ratios and nothing else', () => {
    for (const a of IMAGE_ASPECTS) expect(isAspect(a)).toBe(true);
    for (const bad of ['2:1', '16:10', '', null, 169]) expect(isAspect(bad)).toBe(false);
  });

  it('defaults to a wide cover', () => {
    expect(isAspect(DEFAULT_ASPECT)).toBe(true);
    expect(DEFAULT_ASPECT).toBe('16:9');
  });
});

describe('composePrompt', () => {
  const subject = 'A cluttered workbench at night lit by one anglepoise lamp';

  it('puts the subject FIRST and the style after it', () => {
    const out = composePrompt(subject, 'photoreal');
    expect(out.indexOf(subject)).toBe(0);
    expect(out).toContain('photorealistic photograph');
    // The style must not lead — these models weight the opening most heavily,
    // and a style-first prompt produces variations of the style.
    expect(out.indexOf('photorealistic')).toBeGreaterThan(out.indexOf('workbench'));
  });

  it('terminates the subject so the two halves do not run together', () => {
    expect(composePrompt(subject, 'editorial')).toContain(`${subject}.\n\n`);
    // An already-terminated subject is not double-stopped.
    expect(composePrompt('A red door.', 'editorial')).toContain('A red door.\n\n');
    expect(composePrompt('A red door.', 'editorial')).not.toContain('A red door..');
    expect(composePrompt('Why a red door?', 'editorial')).toContain('Why a red door?\n\n');
  });

  it('collapses whitespace and caps the subject', () => {
    expect(composePrompt('a   b\n\nc', 'editorial')).toContain('a b c.');
    const long = 'x'.repeat(MAX_SUBJECT_LENGTH + 200);
    const out = composePrompt(long, 'editorial');
    expect(out.split('\n\n')[0].replace(/\.$/, '').length).toBe(MAX_SUBJECT_LENGTH);
  });

  it('returns nothing for an empty subject rather than a bare style', () => {
    // A style with no subject generates a generic picture of the style itself,
    // which costs money and tells the author nothing.
    for (const empty of ['', '   ', '\n\n']) expect(composePrompt(empty, 'photoreal')).toBe('');
  });

  it('uses the default style for an unknown key', () => {
    expect(composePrompt(subject, 'made-up')).toContain('Editorial illustration');
  });
});

describe('cleanBrief', () => {
  it('strips a conversational preamble', () => {
    expect(cleanBrief("Sure, here's a scene: A rain-slicked platform at dusk")).toBe(
      'A rain-slicked platform at dusk',
    );
    expect(cleanBrief('Here is the image: A brass valve')).toBe('A brass valve');
  });

  it('strips wrapping quotes, including curly ones', () => {
    expect(cleanBrief('"A brass valve"')).toBe('A brass valve');
    expect(cleanBrief('“A brass valve”')).toBe('A brass valve');
    expect(cleanBrief("'A brass valve'")).toBe('A brass valve');
  });

  it('strips a leading label', () => {
    expect(cleanBrief('Scene: A brass valve')).toBe('A brass valve');
    expect(cleanBrief('Prompt: A brass valve')).toBe('A brass valve');
  });

  it('leaves a clean brief untouched', () => {
    const good = 'A cluttered workbench at night lit by one anglepoise lamp';
    expect(cleanBrief(good)).toBe(good);
  });

  it('survives empty and nullish input', () => {
    expect(cleanBrief('')).toBe('');
    expect(cleanBrief(undefined as unknown as string)).toBe('');
  });

  it('does not eat an apostrophe inside the sentence', () => {
    expect(cleanBrief("A potter's wheel mid-throw")).toBe("A potter's wheel mid-throw");
  });
});
