/**
 * The media library's shared shape.
 *
 * Declared here rather than beside its queries in `./media.server` so the
 * picker component can name what it renders. A Svelte component importing a
 * type from a `*.server.ts` module is a module-graph rule this repo does not
 * bend anywhere else, and "it is only a type, the import gets erased" is
 * exactly the assumption that stops being true at the first build tweak.
 *
 * `$lib/blog/desk/types` and `$lib/blog/analytics` are split from their server
 * halves for the same reason.
 */

export type MediaItem = {
  id: number;
  postId: number;
  filename: string;
  url: string;
  /** The stored MIME type. `video/*` items render as a player, not an image. */
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** The last alt text used for this asset, offered as the default next time
   *  it is inserted. Alt-text coverage is a publish-gate check, and the
   *  cheapest way to raise it is to stop asking the same question twice. */
  altText: string | null;
  /** ISO string, not a Date: a Date would be a lie once it has crossed the
   *  wire, and would put a `new Date(...)` in every consumer. */
  createdAt: string;
};

/** Alt text is a description, not prose. Anything longer is a paste accident. */
export const MAX_ALT_LENGTH = 500;

/** Human-readable byte size for the picker. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
