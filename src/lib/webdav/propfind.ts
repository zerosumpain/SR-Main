// PROPFIND XML response builder. We answer for a fixed set of properties
// regardless of what the client requests — clients accept this and it
// keeps us from having to parse the request body.

import { relToHref } from './paths';

export type PropfindEntry = {
  rel: string;          // "" for the mount root
  isCollection: boolean;
  sizeBytes: number;    // 0 for collections
  mimeType: string;     // 'httpd/unix-directory' for collections
  createdAt: Date;
  updatedAt: Date;
  etag: string | null;  // null for collections
};

function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

function rfc1123(d: Date): string {
  return d.toUTCString();
}

function isoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function renderResponse(e: PropfindEntry): string {
  const href = xmlEscape(relToHref(e.rel, e.isCollection));
  const display = e.rel ? e.rel.split('/').filter(Boolean).pop()! : '';
  const resourcetype = e.isCollection
    ? '<D:resourcetype><D:collection/></D:resourcetype>'
    : '<D:resourcetype/>';
  const contentLength = e.isCollection
    ? ''
    : `<D:getcontentlength>${e.sizeBytes}</D:getcontentlength>`;
  const contentType = e.isCollection
    ? '<D:getcontenttype>httpd/unix-directory</D:getcontenttype>'
    : `<D:getcontenttype>${xmlEscape(e.mimeType || 'application/octet-stream')}</D:getcontenttype>`;
  const etag = e.etag ? `<D:getetag>"${xmlEscape(e.etag)}"</D:getetag>` : '';

  return `<D:response>
  <D:href>${href}</D:href>
  <D:propstat>
    <D:prop>
      <D:displayname>${xmlEscape(display)}</D:displayname>
      ${resourcetype}
      ${contentLength}
      ${contentType}
      <D:creationdate>${isoZ(e.createdAt)}</D:creationdate>
      <D:getlastmodified>${rfc1123(e.updatedAt)}</D:getlastmodified>
      ${etag}
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
</D:response>`;
}

export function buildPropfindXml(entries: PropfindEntry[]): string {
  const body = entries.map(renderResponse).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${body}
</D:multistatus>`;
}
