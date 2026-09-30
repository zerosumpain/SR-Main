import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { BUILDER_REPO_SKILLS } from './executor';

// The builder reads these from its clone of the repository. A rename or a
// deletion here would silently leave every repo build without them.
describe('guidance the repo builder is given', () => {
  it('has an AGENTS.md that fits the prompt budget whole', () => {
    const text = readFileSync('AGENTS.md', 'utf8');
    expect(text.length).toBeGreaterThan(500);
    expect(text.length).toBeLessThanOrEqual(8000);
  });

  it('ships every skill the builder is pointed at, and none of the runbooks for a person', () => {
    for (const name of BUILDER_REPO_SKILLS) {
      const skill = readFileSync(`.claude/skills/${name}/SKILL.md`, 'utf8');
      expect(skill, name).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: `));
    }
    expect(BUILDER_REPO_SKILLS).not.toContain('ship');
    expect(BUILDER_REPO_SKILLS).not.toContain('local-qa');
    expect(existsSync('.claude/skills/ship/SKILL.md')).toBe(true);
  });
});
