import { getAllPosts } from '$lib/blog';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const posts = await getAllPosts();
  const site = 'https://strangeramblings.com';

  const staticPages = ['', '/blog', '/health'];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages.map(path => `
  <url>
    <loc>${site}${path}</loc>
    <changefreq>${path === '' ? 'daily' : 'weekly'}</changefreq>
    <priority>${path === '' ? '1.0' : '0.8'}</priority>
  </url>`).join('')}
  ${posts.map(post => `
  <url>
    <loc>${site}/blog/${post.slug}</loc>
    ${post.publishedAt ? `<lastmod>${new Date(post.publishedAt).toISOString().slice(0, 10)}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('')}
</urlset>`;

  return new Response(xml.trim(), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'max-age=3600',
    },
  });
};
