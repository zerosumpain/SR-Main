export interface PostMeta {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  tags: string[];
  publishedAt: string | null;
}

export interface Post extends PostMeta {
  content: string;
  contentFormat: 'html' | 'markdown';
  previewToken: string;
}
