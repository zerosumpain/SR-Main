import { resolve } from 'node:path';

// Resolves to <project-root>/data/uploads/blog at runtime. The deploy script
// rsyncs `data/` to /opt/strange-rambling-svelte/data/ WITHOUT --delete, so
// uploads survive deploys. Files are streamed back via /api/blog/images/...
export const BLOG_IMAGE_ROOT = resolve(process.cwd(), 'data', 'uploads', 'blog');
