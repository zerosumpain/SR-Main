export interface LintFinding {
  path: string;
  line: number;
  rule: string;
  message: string;
}

export interface LintResult {
  findings: LintFinding[];
}

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
// A line that *defines* a CSS custom property like `--bg: #ffffff;`
// (potentially with !important / fallbacks) — raw hex here is the token
// declaration itself, which is the only legal place for raw hex.
const CUSTOM_PROP_DECL_RE = /^\s*--[a-zA-Z0-9_-]+\s*:/;
const TAILWIND_CLASS_RE = /\bclass\s*=\s*"[^"]*\b(?:bg-|text-|p-\d|m-\d|w-\d|h-\d|flex\b|grid\b)[^"]*"/;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}\n]+)/i;
const FONT_VAR_OR_KEYWORD_RE = /^(?:var\s*\(|inherit|initial|unset|revert)/i;

const FILES_TO_CHECK = /\.(css|scss|sass|less|html|svelte|jsx|tsx|vue)$/i;

/**
 * The read-only design-system reference `syncDesignAssets` writes into the
 * workspace. Nothing under it may ever produce a finding: the agent is told to
 * read it, `.git/info/exclude` hides it, and it is regenerated from
 * `design-assets.ts` every iteration — so a finding here CANNOT be fixed, and
 * three iterations of an unfixable finding aborts the build as
 * `design_lint_loop`.
 *
 * That is not hypothetical. `examples/page.svelte` ships `<div class="grid">`,
 * which `no-tailwind` matches, so every design-system-enforced build that
 * reached iteration 3 died on our own reference file with findings stuck at
 * 1 → 1 → 1 (found 2026-08-09 by a build whose app was complete and serving
 * 200 at iteration 1). The mount was already exempt from `no-raw-hex`; it just
 * was not exempt from the other two rules.
 *
 * `explainer-kit/` is the second such mount (Studio builds) and carries exactly
 * the same hazard: it is read-only, regenerated every iteration, and contains a
 * worked example the agent is told to copy. A finding there cannot be fixed.
 */
const DESIGN_MOUNT_RE = /(^|\/)(design-system|explainer-kit)\//i;

function looksLikeRawFontFamily(line: string): boolean {
  const m = line.match(FONT_FAMILY_RE);
  if (!m) return false;
  return !FONT_VAR_OR_KEYWORD_RE.test(m[1].trim());
}

export function lintDesignSystem(files: Record<string, string>): LintResult {
  const findings: LintFinding[] = [];
  for (const [path, body] of Object.entries(files)) {
    if (!FILES_TO_CHECK.test(path)) continue;
    if (DESIGN_MOUNT_RE.test(path)) continue;
    // Raw hex is legal in a tokens file — that IS the declaration site. The
    // other two rules still apply to a tokens file the agent wrote itself.
    const isTokens = /tokens\.css$/i.test(path);
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (!isTokens && HEX_RE.test(line) && !CUSTOM_PROP_DECL_RE.test(line)) {
        findings.push({
          path,
          line: i + 1,
          rule: 'no-raw-hex',
          message: `Raw hex colour outside tokens.css and not in a CSS custom property declaration: ${line.trim().slice(0, 120)}`,
        });
      }
      if (TAILWIND_CLASS_RE.test(line)) {
        findings.push({
          path,
          line: i + 1,
          rule: 'no-tailwind',
          message: `Tailwind utility class detected: ${line.trim().slice(0, 120)}`,
        });
      }
      if (looksLikeRawFontFamily(line)) {
        findings.push({
          path,
          line: i + 1,
          rule: 'no-raw-font',
          message: `font-family must reference var(--font-*): ${line.trim().slice(0, 120)}`,
        });
      }
    });
  }
  return { findings };
}
