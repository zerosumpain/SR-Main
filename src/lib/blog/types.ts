export interface PostMeta {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  /** Alt text for the cover. The column has existed since 2026-08 and was
   *  written by nothing — the PUT handler never destructured it. */
  coverImageAlt: string | null;
  tags: string[];
  publishedAt: string | null;
}

export interface Post extends PostMeta {
  /** The row id. Needed by anything that has to write against the post from
   *  the public page — the reading beacon and the comment form both do — and
   *  omitted from the returned object until 2026-08-30 even though the query
   *  had always selected it. */
  id: number;
  content: string;
  contentFormat: 'html' | 'markdown';
  previewToken: string;
  /** Reading face for the body copy. Vocabulary in $lib/blog/fonts. */
  bodyFont: string;
}
