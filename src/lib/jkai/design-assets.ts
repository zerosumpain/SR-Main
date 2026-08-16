import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS_MD = `# Strange Ramblings Design System — Cheatsheet

Always import \`tokens.css\` (or copy the relevant CSS variables) at the root of your stylesheet. Never hard-code hex colours or font names.

## Page wrapper
\`\`\`html
<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Section</div>
      <h1>Page Title</h1>
    </div>
  </header>
</div>
\`\`\`

## Section card
\`\`\`html
<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Heading</span>
  </header>
  <p>Body</p>
</section>
\`\`\`

## Inputs and buttons
\`\`\`html
<input class="nm-text-input" />
<button class="nm-save-btn">Save</button>
<button class="nm-btn-ghost">Cancel</button>
<button class="row-link">View</button>
<button class="row-link danger">Delete</button>
\`\`\`

## Status dots
\`\`\`html
<span class="status-dot" data-status="running"></span>
<span class="status-dot" data-status="completed"></span>
<span class="status-dot" data-status="failed"></span>
<span class="status-dot" data-status="pending"></span>
\`\`\`

## Code blocks
Wrap any code-like output in a \`<pre>\` styled with \`background: var(--code-bg); color: var(--code-text); font-family: var(--font-mono);\`.

## Don'ts (linter will reject)
- No raw \`#hex\` colours outside tokens.css.
- No Tailwind utility classes (\`bg-*\`, \`text-*\`, \`p-*\`, \`m-*\`, \`flex\`, \`grid\`).
- No \`font-family:\` outside \`var(--font-display | --font-body | --font-mono)\`.
`;

const README_MD = `# Strange Ramblings Design System

This directory is a read-only mount of the site's canonical design tokens, components, and examples. Read it BEFORE writing any HTML/CSS/Svelte. Your work will be linted against these rules and rejected on violations.

Files:
- \`tokens.css\` — CSS variables for colour, typography, status. Import at the root of your stylesheet.
- \`components.md\` — class cheatsheet for sections, inputs, buttons, status dots.
- \`examples/page.svelte\` — canonical list-page layout demonstrating the design language.

Workflow:
1. Read this file in full.
2. Read \`components.md\` and \`examples/page.svelte\`.
3. When writing styles, \`@import './path/to/tokens.css'\` at the top of your CSS, or paste the relevant \`:root\` variables.
4. Use the documented classes wherever they apply (\`.nm-sec\`, \`.nm-text-input\`, \`.nm-save-btn\`, \`.row-link\`, \`.status-dot\`, \`.kicker\`, \`.page-hdr\`).
5. Never hard-code colours or font names — always go through \`var(--…)\`.
`;

const EXAMPLE_PAGE_SVELTE = `<script lang="ts">
  // Canonical list page lifted from the strangeramblings.com canvas page.
  let { items = [] }: { items: Array<{ id: string; title: string; status: string }> } = $props();
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Example</div>
      <h1>Page Title</h1>
    </div>
    <a class="nm-save-btn" href="/new">+ Create</a>
  </header>

  <section class="nm-sec">
    <header class="nm-sec-hd">
      <span class="sr-label-tight">Items</span>
    </header>
    <div class="grid">
      {#each items as it (it.id)}
        <article class="card">
          <header>
            <span class="status-dot" data-status={it.status}></span>
            <span class="title">{it.title}</span>
          </header>
        </article>
      {/each}
    </div>
  </section>
</div>

<style>
  @import './tokens.css';
  .wrap {
    max-width: 980px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    margin: 0;
    color: var(--text-primary);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 1rem;
    transition: border-color 80ms ease;
  }
  .card:hover {
    border-color: var(--text-primary);
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1rem;
  }
</style>
`;

/**
 * The Studio mount. Unlike `buildDesignAssets` — which inlines its content as
 * string constants — the explainer kit is real, testable JavaScript, so it is
 * read from disk. `static/` is copied to `build/client/` by the adapter and
 * `build/` is rsynced wholesale by ci-deploy, so both paths resolve. Same
 * two-candidate pattern `syncJkaiExtension` already uses for jkai-tools.js.
 */
const EXPLAINER_FILES = [
  'tokens.css',
  'shell.css',
  'shell.js',
  'instruments.js',
  'sim.js',
  'diagram.js',
  'lowpoly.js',
  'chart.js',
  'three.min.js',
  'README.md',
  'api.md',
  'scenes.md',
  'SKILL.md',
  'examples/chapter.html',
  // The Field Study System. A studio build is an INFORMATION project, and this
  // is the system it is built against: the nine templates, the machine-readable
  // registry the chapter plan names ids from, the CSS those templates are made
  // of (ported to the kit's --ex-* tokens, because a studio build never loads
  // app.css), and the ship gate.
  'field-study/README.md',
  'field-study/TEMPLATES.md',
  'field-study/templates.json',
  'field-study/field-study.css',
  'field-study/CHECKLIST.md',
  // VENDOR.md (three.js provenance) is intentionally NOT listed here — the
  // agent needs the kit to build with, not its licensing paperwork. Omitting
  // it is safe: buildExplainerAssets only throws for files it lists and
  // cannot find, never for files on disk it doesn't list.
];

export async function buildExplainerAssets(repoRoot: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const rel of EXPLAINER_FILES) {
    const candidates = [
      path.join(repoRoot, 'static/explainer-kit', rel),
      path.join(repoRoot, 'build/client/explainer-kit', rel),
    ];
    let body: string | null = null;
    for (const c of candidates) {
      body = await readFile(c, 'utf-8').catch(() => null);
      if (body != null) break;
    }
    if (body == null) missing.push(rel);
    else out[rel] = body;
  }
  if (missing.length > 0) {
    // Fail loudly. A half-mounted kit gives the agent a README promising modules
    // that are not there, and it will spend an iteration discovering that.
    throw new Error(`buildExplainerAssets: missing ${missing.join(', ')} under static/ and build/client/`);
  }
  return out;
}

export async function buildDesignAssets(repoRoot: string): Promise<Record<string, string>> {
  const appCss = await readFile(path.join(repoRoot, 'src/app.css'), 'utf-8').catch(() => '');
  const nmTokens = await readFile(path.join(repoRoot, 'src/lib/styles/nm-tokens.css'), 'utf-8').catch(
    () => '',
  );
  const rootMatch = appCss.match(/:root\s*\{[\s\S]*?\n\}/);
  const rootBlock = rootMatch ? rootMatch[0] : '';
  const tokens = `/* Strange Ramblings design tokens — generated from app.css :root + nm-tokens.css */\n${rootBlock}\n\n${nmTokens}\n`;
  return {
    'README.md': README_MD,
    'tokens.css': tokens,
    'components.md': COMPONENTS_MD,
    'examples/page.svelte': EXAMPLE_PAGE_SVELTE,
  };
}
