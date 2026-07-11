// Markdown-lite for the prose block: escape-then-allowlist, the same XSS-safe
// approach as data-spine's AskModel renderer. Supports **bold**, [text](url)
// (site-relative or http(s) only) and blank-line paragraphs. Nothing else.

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderProse(body: string): string {
  const escaped = escapeHtml(body);
  const inline = escaped
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, url: string) => {
      if (url.startsWith('/')) return `<a href="${url}">${text}</a>`;
      if (/^https?:\/\//.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
      return whole; // unsupported scheme — leave as literal text
    });
  return inline
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replaceAll('\n', '<br />')}</p>`)
    .join('');
}
