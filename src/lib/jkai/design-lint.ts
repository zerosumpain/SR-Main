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

function looksLikeRawFontFamily(line: string): boolean {
  const m = line.match(FONT_FAMILY_RE);
  if (!m) return false;
  return !FONT_VAR_OR_KEYWORD_RE.test(m[1].trim());
}

export function lintDesignSystem(files: Record<string, string>): LintResult {
  const findings: LintFinding[] = [];
  for (const [path, body] of Object.entries(files)) {
    if (!FILES_TO_CHECK.test(path)) continue;
    const isTokens = /tokens\.css$/i.test(path) || /design-system\//i.test(path);
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
