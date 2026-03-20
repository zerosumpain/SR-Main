export interface PostMeta {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
}

export interface Post extends PostMeta {
  content: string;
}
