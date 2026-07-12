// Markdown-lite for the prose block: escape-then-allowlist, the same XSS-safe
// approach as data-spine's AskModel renderer. Supports # … #### headings,
// **bold**, *italic*, __underline__, [text](url) (site-relative or http(s)
// only) and blank-line paragraphs. Nothing else.

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) => {
      if (url.startsWith('/')) return `<a href="${url}">${text}</a>`;
      if (/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
      return whole; // unsupported scheme — leave as literal text
    });
}

export function renderProse(body: string): string {
  const escaped = escapeHtml(body);
  return escaped
    .split(/\n{2,}/)
    .map((chunk) => {
      // A heading line renders alone; other lines of the chunk stay a paragraph.
      const lines = chunk.split('\n');
      const out: string[] = [];
      let para: string[] = [];
      const flush = () => {
        if (para.length) out.push(`<p>${renderInline(para.join('<br />'))}</p>`);
        para = [];
      };
      for (const line of lines) {
        const h = line.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
          flush();
          const level = h[1].length;
          out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
        } else {
          para.push(line);
        }
      }
      flush();
      return out.join('');
    })
    .join('');
}
