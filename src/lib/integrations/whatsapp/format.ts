// Pure helpers for the WhatsApp v2 node. No I/O, no service — deliberately
// side-effect free so they can be unit-tested in isolation and reused by the
// generator's exemplars.

/** WhatsApp's practical per-message character ceiling. Longer bodies must be
 *  split into several sequential sends. */
export const WHATSAPP_MAX_CHARS = 4096;

/**
 * Translate a Markdown string into WhatsApp's much smaller formatting dialect.
 *
 * WhatsApp supports: *bold*, _italic_, ~strike~, ```monospace```. It has NO
 * headings, NO links syntax, NO `##`, NO `[text](url)`. This converts the
 * common Markdown a model emits into the closest WhatsApp equivalent and
 * strips the rest so the recipient never sees raw `**` / `##` / `[..](..)`.
 *
 *   **bold**            → *bold*
 *   __bold__            → *bold*
 *   _italic_            → _italic_        (unchanged — same glyph)
 *   ## Heading          → *Heading*       (bold line)
 *   [text](url)         → text (url)
 *   ![alt](url)         → alt (url)
 *   - bullet / * / +    → • bullet
 *   `code`              → code            (backticks stripped)
 *   ``` fences          → removed (content kept)
 */
export function markdownToWhatsApp(md: string): string {
  if (!md) return '';
  let text = md.replace(/\r\n/g, '\n');

  // Drop fenced-code markers but keep the code inside.
  text = text.replace(/```[^\n]*\n?/g, '');

  // Images before links (image syntax is a superset of link syntax).
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) =>
    alt.trim() ? `${alt.trim()} (${url})` : url,
  );

  // Links → "text (url)".
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, label: string, url: string) =>
    `${label.trim()} (${url})`,
  );

  // Bold → single-asterisk WhatsApp bold. Do this BEFORE bullet handling so a
  // `**` never gets mistaken for a `*` bullet marker.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');
  text = text.replace(/__([^_\n]+)__/g, '*$1*');

  // Inline code → plain text (WhatsApp has no single-backtick inline mono).
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Line-oriented transforms: headings and bullets.
  text = text
    .split('\n')
    .map((line) => {
      // Heading: leading #'s → bold line (drop any trailing #'s too).
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        const body = heading[2].trim();
        return body ? `*${body}*` : '';
      }
      // Bullet: -, *, or + at line start → • .
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (bullet) return `${bullet[1]}• ${bullet[2]}`;
      return line;
    })
    .join('\n');

  // Collapse runs of 3+ blank lines (fence removal can leave gaps).
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Split a message that exceeds {@link WHATSAPP_MAX_CHARS} into a sequence of
 * sends. Splits on paragraph boundaries (blank lines) where possible; a single
 * paragraph longer than the limit is hard-split. When the number of chunks
 * would exceed `maxChunks`, the surplus is dropped and a "… (truncated)" tail
 * is appended to the last retained chunk.
 *
 * `maxChunks <= 0` means "no cap" (send however many are needed).
 */
export function chunkMessage(text: string, maxChunks = 3): string[] {
  if (text.length <= WHATSAPP_MAX_CHARS) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    let p = paragraph;
    // Hard-split an oversized single paragraph.
    while (p.length > WHATSAPP_MAX_CHARS) {
      flush();
      chunks.push(p.slice(0, WHATSAPP_MAX_CHARS));
      p = p.slice(WHATSAPP_MAX_CHARS);
    }
    if (!p) continue;
    const candidate = current ? `${current}\n\n${p}` : p;
    if (candidate.length <= WHATSAPP_MAX_CHARS) {
      current = candidate;
    } else {
      flush();
      current = p;
    }
  }
  flush();

  if (maxChunks > 0 && chunks.length > maxChunks) {
    const kept = chunks.slice(0, maxChunks);
    const marker = '\n\n… (truncated)';
    let last = kept[kept.length - 1];
    if (last.length + marker.length > WHATSAPP_MAX_CHARS) {
      last = last.slice(0, WHATSAPP_MAX_CHARS - marker.length);
    }
    kept[kept.length - 1] = last + marker;
    return kept;
  }

  return chunks;
}
