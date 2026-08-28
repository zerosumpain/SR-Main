import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * The skills library, read from `data/skills/`.
 *
 * These are the 126 SKILL.md files chat routes on. They live here so
 * the in-process chat lane can use them too — `data/` is already rsynced by
 * `ci-release.sh`, so they need no deployment work of their own.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE OLD INDEX, and it is the whole reason routing
 * should get better rather than merely equal:
 *
 *   It truncated every description to exactly 60 characters when building
 *   the index, and then instructs the model to load anything "even partially
 *   relevant". 41 of these 126 descriptions are longer than 60 chars, so their
 *   keywords are cut mid-sentence — and whichever skill happens to fit a keyword
 *   inside 60 characters wins the routing. `google-workspace` owned every
 *   calendar question for exactly that reason: it was the only line short enough
 *   to keep the word "Calendar".
 *
 * We do not truncate. The index carries the full description.
 */

const SKILLS_DIR = join(process.cwd(), 'data', 'skills');

export interface SkillMeta {
  /** Canonical id: the path under data/skills, e.g. "jkai-canvas" or "research/arxiv". */
  id: string;
  /** Frontmatter name. NOT unique — `computer-use` is declared by two skills. */
  name: string;
  description: string;
  tags: string[];
  /** Relative paths of the skill's reference documents, if any. */
  references: string[];
}

let cache: SkillMeta[] | null = null;

/** Minimal frontmatter reader — enough for name/description/tags, no YAML dep. */
export function parseFrontmatter(src: string): { name: string; description: string; tags: string[]; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name: '', description: '', tags: [], body: src };
  const [, fm, body] = m;
  const scalar = (key: string): string => {
    const line = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    if (!line) return '';
    const first = line[1].trim();
    // YAML block scalars: `description: |` (or `>`), with the real value on the
    // indented lines beneath. Several skills in this library use them, and
    // reading the marker as the value gives every one of them a description of
    // "|" — which then indexes and searches as nothing at all.
    if (first === '|' || first === '>' || /^[|>][-+]?\d*$/.test(first)) {
      const lines = fm.split(/\r?\n/);
      const start = lines.findIndex((l) => new RegExp(`^${key}:[ \\t]*[|>]`).test(l));
      if (start === -1) return '';
      const out: string[] = [];
      for (const l of lines.slice(start + 1)) {
        if (l.trim() === '') { out.push(''); continue; }
        if (!/^\s/.test(l)) break; // dedented — the block has ended
        out.push(l.replace(/^\s+/, ''));
      }
      // `>` folds onto one line; `|` keeps newlines. Either way collapse for an
      // index line.
      return out.join(first.startsWith('>') ? ' ' : ' ').replace(/\s+/g, ' ').trim();
    }
    return first.replace(/^["']|["']$/g, '').trim();
  };
  const tagLine = fm.match(/^\s*tags:\s*\[(.*?)\]\s*$/m);
  const tags = tagLine
    ? tagLine[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    : [];
  return { name: scalar('name'), description: scalar('description'), tags, body };
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (e === 'SKILL.md') out.push(p);
  }
  return out;
}

function listReferences(skillDir: string): string[] {
  const refDir = join(skillDir, 'references');
  if (!existsSync(refDir)) return [];
  const out: string[] = [];
  const rec = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else out.push(relative(skillDir, p).split(sep).join('/'));
    }
  };
  try {
    rec(refDir);
  } catch {
    /* a missing reference dir is not an error */
  }
  return out.sort();
}

/** Every skill in the library. Cached — the files only change on deploy. */
export function loadSkillIndex(): SkillMeta[] {
  if (cache) return cache;
  const files = walk(SKILLS_DIR);
  const metas: SkillMeta[] = [];
  for (const file of files) {
    const dir = file.slice(0, -'/SKILL.md'.length);
    const id = relative(SKILLS_DIR, dir).split(sep).join('/');
    if (!id) continue;
    try {
      const { name, description, tags } = parseFrontmatter(readFileSync(file, 'utf8'));
      metas.push({ id, name: name || id, description, tags, references: listReferences(dir) });
    } catch {
      /* an unreadable skill is skipped, not fatal */
    }
  }
  metas.sort((a, b) => a.id.localeCompare(b.id));
  cache = metas;
  return cache;
}

/** Test seam — the index is cached for the process lifetime otherwise. */
export function clearSkillCache(): void {
  cache = null;
}

/**
 * Resolve an id or a frontmatter name to exactly one skill.
 *
 * Ids are unique by construction (they are paths). Names are not: two skills
 * declare `computer-use`. An ambiguous name resolves to nothing rather than to
 * an arbitrary one of them, and the caller is told to use the id.
 */
export function resolveSkill(idOrName: string): { skill: SkillMeta } | { error: string } {
  const q = idOrName.trim();
  if (!q) return { error: 'no skill named' };
  const all = loadSkillIndex();

  const byId = all.find((s) => s.id === q);
  if (byId) return { skill: byId };

  const byName = all.filter((s) => s.name === q);
  if (byName.length === 1) return { skill: byName[0] };
  if (byName.length > 1) {
    return {
      error: `"${q}" is declared by ${byName.length} skills (${byName.map((s) => s.id).join(', ')}). Use the id.`,
    };
  }

  const near = all
    .filter((s) => s.id.includes(q) || s.name.includes(q))
    .slice(0, 5)
    .map((s) => s.id);
  return {
    error: near.length
      ? `no skill "${q}". Closest ids: ${near.join(', ')}`
      : `no skill "${q}". Call skills_list to see what exists.`,
  };
}

/** Read a skill's body, or one of its reference documents. */
export function readSkillBody(skill: SkillMeta, reference?: string): { text: string } | { error: string } {
  if (reference) {
    // Path-traversal guard: only files the index already listed for this skill.
    if (!skill.references.includes(reference)) {
      return {
        error: `"${reference}" is not a reference of ${skill.id}. It has: ${skill.references.join(', ') || '(none)'}`,
      };
    }
    try {
      return { text: readFileSync(join(SKILLS_DIR, skill.id, reference), 'utf8') };
    } catch (err) {
      return { error: `could not read ${reference}: ${err instanceof Error ? err.message : 'unknown'}` };
    }
  }
  try {
    const src = readFileSync(join(SKILLS_DIR, skill.id, 'SKILL.md'), 'utf8');
    return { text: parseFrontmatter(src).body.trim() || src };
  } catch (err) {
    return { error: `could not read ${skill.id}: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

/** Keyword search over id, name, description and tags. Ranked, not filtered. */
export function searchSkills(query: string, limit = 10): SkillMeta[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const scored = loadSkillIndex().map((s) => {
    const id = s.id.toLowerCase();
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    const tags = s.tags.map((t) => t.toLowerCase());
    let score = 0;
    for (const t of terms) {
      // The id is canonical and unique; a name is neither. Scoring them together
      // makes an exact id tie with a mere name match, and two skills declaring
      // the same name then sort alphabetically — so asking for "computer-use"
      // returned "autonomous-ai-agents/computer-use" rather than the skill
      // actually called that.
      if (id === t) score += 12;
      else if (id.includes(t)) score += 4;

      if (name === t) score += 8;
      else if (name.includes(t)) score += 3;

      if (tags.some((tag) => tag === t)) score += 3;
      else if (tags.some((tag) => tag.includes(t))) score += 1;

      // Full description, not a 60-char prefix — see the note at the top.
      if (desc.includes(t)) score += 2;
    }
    return { s, score };
  });
  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, limit)
    .map((r) => r.s);
}

/**
 * The compact index for the system prompt: one line per skill, FULL description.
 * ~126 lines. Deliberately not truncated.
 */
export function renderSkillIndex(): string {
  const all = loadSkillIndex();
  if (all.length === 0) return '';
  const lines = all.map((s) => `- ${s.id}: ${s.description || '(no description)'}`);
  return lines.join('\n');
}
