// OS-junk file filter. Finder, Windows, and Office all sprinkle hidden
// state files into directories they touch. We silently swallow PUTs for
// these (return 201 without writing) and hide them from PROPFIND so they
// can't accumulate as empty workflow_files rows.

const JUNK_PATTERNS: RegExp[] = [
  /(^|\/)\.DS_Store$/,                        // macOS Finder
  /(^|\/)\.AppleDouble$/,
  /(^|\/)\._.+$/,                              // macOS resource forks
  /(^|\/)\.Trashes(\/|$)/,
  /(^|\/)\.Spotlight-V100(\/|$)/,
  /(^|\/)\.fseventsd(\/|$)/,
  /(^|\/)\.TemporaryItems(\/|$)/,
  /(^|\/)\.DocumentRevisions-V100(\/|$)/,
  /(^|\/)~\$.+/,                                // Office lock files
  /(^|\/)\.~lock\..+#$/,                       // LibreOffice
  /(^|\/)Thumbs\.db$/,                          // Windows Explorer
  /(^|\/)desktop\.ini$/,
];

export function isJunkPath(rel: string): boolean {
  return JUNK_PATTERNS.some((p) => p.test(rel));
}
