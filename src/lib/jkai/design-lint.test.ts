import { describe, it, expect } from 'vitest';
import { lintDesignSystem } from './design-lint';
import { buildDesignAssets } from './design-assets';

// The linter's findings are fed back to the agent and, after three iterations
// with no decrease, abort the build. So a finding on a file the agent cannot
// edit is not noise — it is a build-killer.

describe('lintDesignSystem', () => {
  it('ignores the read-only reference mount', () => {
    const offending = '<div class="grid">\n  <span style="color: #ff0000">x</span>\n';
    expect(
      lintDesignSystem({ 'design-system/examples/page.svelte': offending }).findings,
    ).toEqual([]);
    // Same content in the agent's own file is still a finding — the exemption
    // is about who can fix it, not about the rules going soft.
    expect(lintDesignSystem({ 'src/routes/page.svelte': offending }).findings.length).toBe(2);
  });

  it('does not flag the design assets we actually ship', async () => {
    // The regression: examples/page.svelte contains `<div class="grid">`, which
    // no-tailwind matches. Mounted at design-system/, it produced one finding
    // per iteration that the agent had no way to remove.
    const assets = await buildDesignAssets(process.cwd());
    const mounted = Object.fromEntries(
      Object.entries(assets).map(([name, body]) => [`design-system/${name}`, String(body)]),
    );
    expect(lintDesignSystem(mounted).findings).toEqual([]);
  });

  it('still allows raw hex only where tokens are declared', () => {
    expect(lintDesignSystem({ 'styles/tokens.css': '  --bg: #0b0b0c;\n' }).findings).toEqual([]);
    expect(
      lintDesignSystem({ 'styles/app.css': '  background: #0b0b0c;\n' }).findings.map((f) => f.rule),
    ).toEqual(['no-raw-hex']);
    // A tokens file the agent wrote is exempt from hex, not from everything.
    expect(
      lintDesignSystem({ 'styles/tokens.css': 'body { font-family: Helvetica; }\n' }).findings.map(
        (f) => f.rule,
      ),
    ).toEqual(['no-raw-font']);
  });
});

describe('read-only mounts are exempt', () => {
  it('never reports a finding inside explainer-kit/', () => {
    const { findings } = lintDesignSystem({
      'explainer-kit/examples/chapter.html': '<div class="grid" style="color:#ff0000">x</div>',
      'explainer-kit/tokens.css': 'body { font-family: Helvetica; }',
    });
    expect(findings).toEqual([]);
  });

  it('still reports the same violations outside the mount', () => {
    const { findings } = lintDesignSystem({
      'src/chapter.html': '<div class="grid" style="color:#ff0000">x</div>',
    });
    expect(findings.map((f) => f.rule).sort()).toEqual(['no-raw-hex', 'no-tailwind']);
  });
});
