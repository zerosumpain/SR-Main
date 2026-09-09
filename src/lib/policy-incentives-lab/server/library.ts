import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { LIBRARY_TYPES, type LibraryPage, type LibraryContent, type LibraryDocument } from '../library';
import { MAX_TEXT, MAX_UPLOAD_BYTES, parseUpload } from './input';

const GOV = 'https://www.gov.uk';
const hosts = new Set(['www.gov.uk', 'assets.publishing.service.gov.uk']);
/** No arbitrary URLs, credentials, ports or cross-host redirects. */
export function officialUrl(input: string): URL {
  const u = new URL(input, GOV);
  if (u.protocol !== 'https:' || !hosts.has(u.hostname) || u.username || u.password || u.port) throw new Error('Only official GOV.UK content is supported');
  return u;
}
const pathSchema = z.string().max(1500).regex(/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/);
export function publicationPath(input: unknown) { return pathSchema.parse(input); }
export async function officialBytes(input: string, fetcher: typeof fetch = fetch, signal = AbortSignal.timeout(20000)): Promise<{ bytes: Buffer; mime: string }> {
  let url = officialUrl(input);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { accept: 'application/json,application/pdf,text/plain,*/*', 'user-agent': 'StrangeRamblings-PolicyLab/1.0' } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const target = response.headers.get('location'); if (!target) throw new Error('GOV.UK redirect has no destination');
      url = officialUrl(new URL(target, url).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GOV.UK content unavailable (${response.status}). Try again or upload the document.`); }
    if (Number(response.headers.get('content-length')) > MAX_UPLOAD_BYTES) { await response.body?.cancel(); throw new Error('GOV.UK document exceeds 5 MiB; choose a smaller attachment'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('GOV.UK returned no content');
    const chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > MAX_UPLOAD_BYTES) { await reader.cancel(); throw new Error('GOV.UK document exceeds 5 MiB'); } chunks.push(part.value); } }
    finally { reader.releaseLock(); }
    return { bytes: Buffer.concat(chunks), mime: response.headers.get('content-type')?.split(';')[0] ?? '' };
  }
  throw new Error('Too many GOV.UK redirects');
}
const text = z.string();
const contentSchema = z.object({ title: text, description: text.nullish(), document_type: text, first_published_at: text.nullish(), public_updated_at: text.nullish(), withdrawn_notice: z.object({ withdrawn_at: text.nullish(), explanation: text.nullish() }).passthrough().nullish(),
  details: z.object({ body: text.nullish(), first_public_at: text.nullish(), attachments: z.array(z.object({ title: text, url: text, attachment_type: text.optional(), content_type: text.optional() })).optional() }).passthrough(),
  links: z.object({ organisations: z.array(z.object({ title: text })).optional() }).passthrough().optional(),
});
export async function searchLibrary(params: URLSearchParams, fetcher: typeof fetch = fetch): Promise<LibraryPage> {
  const kind = z.enum(['policy', 'consultation', 'guidance', 'all']).parse(params.get('kind') ?? 'policy');
  const start = z.coerce.number().int().min(0).max(1_000_000).parse(params.get('start') ?? 0);
  const q = z.string().max(300).parse(params.get('q') ?? '');
  const organisation = z.string().max(150).regex(/^[a-z0-9-]*$/).parse(params.get('organisation') ?? '');
  const url = new URL('/api/search.json', GOV);
  url.search = new URLSearchParams({ filter_content_store_document_type: LIBRARY_TYPES[kind].types, count: '20', start: String(start), fields: 'title,link,description,public_timestamp,organisations,content_store_document_type', order: '-public_timestamp', ...(q ? { q } : {}), ...(organisation ? { filter_organisations: organisation } : {}) }).toString();
  const { bytes } = await officialBytes(url.href, fetcher);
  const data = z.object({ total: z.number(), results: z.array(z.object({ title: text, link: text, description: text.nullish(), public_timestamp: text.nullish(), organisations: z.array(z.object({ title: text })).optional(), content_store_document_type: text.optional() })) }).parse(JSON.parse(bytes.toString()));
  return { total: data.total, start, count: 20, retrieved_at: new Date().toISOString(), entries: data.results.map(r => ({ title: r.title, path: publicationPath(r.link), description: r.description ?? '', publisher: r.organisations?.map(o => o.title).join('; ') || 'Publisher not stated', updated: r.public_timestamp ?? null, type: r.content_store_document_type ?? 'unknown' })) };
}
/** Never execute or render imported HTML. Retain headings, paragraphs and table cell boundaries. */
export function htmlText(html: string): string {
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    document.querySelectorAll('script,style,iframe,object,svg,noscript').forEach(n => n.remove());
    document.querySelectorAll('br,p,div,section,h1,h2,h3,h4,h5,h6,li,tr').forEach(n => { n.before(document.createTextNode('\n')); n.after(document.createTextNode('\n')); });
    document.querySelectorAll('td,th').forEach(n => n.after(document.createTextNode(' | ')));
    return document.body.textContent?.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim() ?? '';
  } finally { dom.window.close(); }
}
export async function loadLibraryContent(pathInput: unknown, selectedInput: unknown = 0, fetcher: typeof fetch = fetch): Promise<LibraryContent> {
  const path = publicationPath(pathInput); const selected = z.coerce.number().int().min(0).max(1000).parse(selectedInput);
  const signal = AbortSignal.timeout(45000);
  const get = async (url: string) => contentSchema.parse(JSON.parse((await officialBytes(url, fetcher, signal)).bytes.toString()));
  const item = await get(`${GOV}/api/content${path}`);
  const withdrawn = !!(item.withdrawn_notice?.withdrawn_at || item.withdrawn_notice?.explanation);
  const documents: LibraryDocument[] = (item.details.attachments ?? []).map(a => {
    let url = ''; try { url = officialUrl(a.url).href; } catch { /* Listed but never fetched. */ }
    const format = a.attachment_type === 'html' ? 'html' : new URL(url || GOV).pathname.split('.').pop()?.toLowerCase() ?? 'unknown';
    return { title: a.title, url, format, supported: !!url && ['html', 'pdf', 'docx', 'txt'].includes(format) };
  });
  // HTML publications/guidance carry their operative text directly. Publication
  // landing pages with attachments must load an attachment, not just a summary.
  if (!documents.length) documents.push({ title: item.title, url: `${GOV}${path}`, format: 'html', supported: !!item.details.body });
  if (selected >= documents.length) throw new Error('Unknown publication attachment');
  const document = documents[selected];
  let sections: LibraryContent['sections'] = []; const extractionWarnings: string[] = [];
  try {
  if (!document.supported) throw new Error('This attachment cannot be imported. Choose another document, or open GOV.UK and upload a supported PDF, DOCX or TXT.');
  if (document.format === 'html') {
    const childPath = publicationPath(new URL(document.url).pathname);
    const child = childPath === path ? item : await get(`${GOV}/api/content${childPath}`);
    const body = htmlText(child.details.body ?? '');
    if (!body) throw new Error('No policy body available; a publication summary is not a substitute. Choose another attachment or upload it.');
    sections = [{ id: 'govuk-body', location: `${document.title} — ${document.url}`, text: body }];
  } else {
    const { bytes, mime } = await officialBytes(document.url, fetcher, signal);
    sections = (await parseUpload(bytes, `publication.${document.format}`, mime)).map(s => ({ ...s, location: `${document.title} — ${s.location} — ${document.url}` }));
  }
  if (!sections.some(s => s.text.trim()) || sections.reduce((n, s) => n + s.text.length, 0) > MAX_TEXT) throw new Error('No usable full text, or document exceeds 250000 characters. Choose a smaller document; content is never silently truncated.');
  } catch (e) { sections = []; extractionWarnings.push((e as Error).message); }
  return { path, title: item.title, publisher: item.links?.organisations?.map(o => o.title).join('; ') || 'Publisher not stated', publication_date: (item.first_published_at ?? item.details.first_public_at)?.slice(0, 10) ?? null, source_url: `${GOV}${path}`, updated: item.public_updated_at ?? null, retrieved_at: new Date().toISOString(), withdrawn, documents, selected, sections,
    warnings: [...extractionWarnings, ...(withdrawn ? ['GOV.UK marks this publication as withdrawn. It is historical material.'] : []), ...(documents.length > 1 ? ['This publication has multiple documents. Only the selected document is imported; choose the operative policy, not an impact assessment or annex.'] : [])] };
}
