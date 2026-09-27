import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSkillIndex, resolveSkill, readSkillBody, searchSkills,
  renderSkillIndex, parseFrontmatter, clearSkillCache,
} from '$lib/jkai/skills/registry';

beforeEach(() => clearSkillCache());

describe('skill index', () => {
  it('keeps the site domain guides available after catalogue pruning', () => {
    const ids = loadSkillIndex().map((skill) => skill.id);
    expect(ids).toEqual(expect.arrayContaining([
      'jkai-general', 'jkai-canvas', 'jkai-files', 'jkai-health',
      'jkai-gmail', 'jkai-calendar', 'jkai-home-assistant', 'jkai-utility',
    ]));
  });

  it('gives every skill a non-empty id', () => {
    expect(loadSkillIndex().every((s) => s.id.length > 0)).toBe(true);
  });

  it('ids are unique even though frontmatter names are not', () => {
    const all = loadSkillIndex();
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
  });

  it('keeps nested skills addressable by path', () => {
    expect(loadSkillIndex().some((s) => s.id.includes('/'))).toBe(true);
  });
});

describe('the 60-character truncation trap', () => {
  /**
   * The old index cut every description to exactly 60 chars,
   * then told the model to load anything "even partially relevant". So routing
   * was decided by which keywords happened to survive the cut — `google-workspace`
   * owned every calendar question because it was the only line short enough to
   * keep the word "Calendar". Not repeating that is the point of this stage.
   */
  it('the library really does contain descriptions longer than 60 chars', () => {
    const long = loadSkillIndex().filter((s) => s.description.length > 60);
    expect(long.length).toBeGreaterThan(20);
  });

  it('the rendered index does NOT truncate them', () => {
    const index = renderSkillIndex();
    const longest = loadSkillIndex()
      .filter((s) => s.description.length > 60)
      .sort((a, b) => b.description.length - a.description.length)[0];
    expect(index).toContain(longest.description);
  });

  it('a keyword past the 60th character is still searchable', () => {
    const victim = loadSkillIndex().find((s) => {
      if (s.description.length <= 70) return false;
      const tail = s.description.slice(60).match(/[A-Za-z]{6,}/);
      return Boolean(tail);
    });
    expect(victim, 'expected at least one long description').toBeDefined();
    const word = victim!.description.slice(60).match(/[A-Za-z]{6,}/)![0];
    expect(searchSkills(word, 30).map((s) => s.id)).toContain(victim!.id);
  });
});

describe('resolveSkill', () => {
  it('refuses ambiguous names and resolves the canonical ID', () => {
    const index = loadSkillIndex();
    const template = index[0];
    index.push(
      { ...template, id: 'fixture/a', name: 'fixture-duplicate' },
      { ...template, id: 'fixture/b', name: 'fixture-duplicate' },
    );
    expect(resolveSkill('fixture-duplicate')).toHaveProperty('error');
    expect(resolveSkill('fixture/a')).toMatchObject({ skill: { id: 'fixture/a' } });
  });

  it('resolves by id', () => {
    const id = loadSkillIndex()[0].id;
    const r = resolveSkill(id);
    expect('skill' in r && r.skill.id).toBe(id);
  });

  it('suggests near matches for an unknown name', () => {
    const r = resolveSkill('canvas');
    if ('error' in r) expect(r.error).toMatch(/Closest ids|skills_list/);
    else expect(r.skill.id).toBeTruthy();
  });

  it('errors on empty input', () => {
    expect(resolveSkill('  ')).toHaveProperty('error');
  });
});

describe('readSkillBody', () => {
  it('returns the body without the frontmatter block', () => {
    const s = loadSkillIndex().find((x) => x.id === 'jkai-canvas') ?? loadSkillIndex()[0];
    const r = readSkillBody(s);
    expect('text' in r).toBe(true);
    if ('text' in r) {
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.text.startsWith('---')).toBe(false);
    }
  });

  it('refuses a reference the skill does not declare — path traversal guard', () => {
    const s = loadSkillIndex()[0];
    const r = readSkillBody(s, '../../../etc/passwd');
    expect(r).toHaveProperty('error');
  });

  it('reads a declared reference', () => {
    const withRefs = loadSkillIndex().find((s) => s.references.length > 0);
    expect(withRefs, 'expected some skill to have references').toBeDefined();
    const r = readSkillBody(withRefs!, withRefs!.references[0]);
    expect('text' in r).toBe(true);
  });
});

describe('parseFrontmatter', () => {
  it('reads name, description and tags', () => {
    const p = parseFrontmatter(
      '---\nname: demo\ndescription: "Does a thing"\nmetadata:\n  routing:\n    tags: [a, b]\n---\n\nBody here',
    );
    expect(p).toMatchObject({ name: 'demo', description: 'Does a thing', tags: ['a', 'b'] });
    expect(p.body.trim()).toBe('Body here');
  });

  it('survives a file with no frontmatter', () => {
    const p = parseFrontmatter('# Just a heading');
    expect(p.name).toBe('');
    expect(p.body).toBe('# Just a heading');
  });
});

describe('searchSkills', () => {
  it('ranks an exact id match first', () => {
    const id = loadSkillIndex().find((s) => !s.id.includes('/'))!.id;
    expect(searchSkills(id, 5)[0].id).toBe(id);
  });

  it('returns nothing for a query of only short noise', () => {
    expect(searchSkills('a b')).toEqual([]);
  });
});

describe('id outranks name (the collision case)', () => {
  it('"computer-use" returns the skill whose ID is that, not one merely named it', () => {
    const all = loadSkillIndex();
    const sameName = all.filter((s) => s.name === 'computer-use');
    if (sameName.length < 2) return; // library changed; nothing to prove
    expect(searchSkills('computer-use', 5)[0].id).toBe('computer-use');
  });
});
