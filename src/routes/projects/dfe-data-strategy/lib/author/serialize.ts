// serialize.ts — DOM-free conversion between the Author's sanitized HTML and
// markdown/plain text. Handles exactly the sanitizer's allowlist (a closed world,
// which is what makes regex-based conversion safe here).

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&([a-zA-Z]+|#\d+);/g, (m, name) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (name.startsWith('#')) {
      const code = parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : m;
    }
    return m;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sanitized HTML → readable plain text (for the coverage matcher / LLM prompts). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/li|\/h3|\/h4|\/blockquote|\/ul|\/ol)[^>]*>/g, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sanitized HTML → markdown (for exports and the deep-review prompt). */
export function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<ol>([\s\S]*?)<\/ol>/g, (_, inner: string) => {
    let n = 0;
    return '\n' + inner.replace(/<li>([\s\S]*?)<\/li>/g, (_m, t: string) => `${++n}. ${t.trim()}\n`) + '\n';
  });
  s = s.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, inner: string) => '\n' + inner.replace(/<li>([\s\S]*?)<\/li>/g, (_m, t: string) => `- ${t.trim()}\n`) + '\n');
  s = s.replace(/<h3>([\s\S]*?)<\/h3>/g, '\n### $1\n\n');
  s = s.replace(/<h4>([\s\S]*?)<\/h4>/g, '\n#### $1\n\n');
  s = s.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, t: string) => '\n> ' + htmlToText(t) + '\n\n');
  s = s.replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, '**$2**');
  s = s.replace(/<(i|em)>([\s\S]*?)<\/\1>/g, '*$2*');
  s = s.replace(/<u>([\s\S]*?)<\/u>/g, '$1');
  s = s.replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, '[$2]($1)');
  s = s.replace(/<a>([\s\S]*?)<\/a>/g, '$1');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<p>([\s\S]*?)<\/p>/g, (_, t: string) => `${t.trim()}\n\n`);
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A whole strategy document → publishable markdown. */
export function docToMarkdown(doc: { title: string; sections: { title: string; html: string }[] }): string {
  const parts = [`# ${doc.title}`, ''];
  for (const s of doc.sections) {
    parts.push(`## ${s.title}`, '');
    const body = htmlToMarkdown(s.html);
    parts.push(body || '_Not written yet._', '');
  }
  parts.push('---', `_Drafted in Keystone (/projects/dfe-data-strategy/author) — a decision-support tool, not an official strategy._`);
  return parts.join('\n');
}

/** Markdown (subset) → sanitizer-allowlist HTML (for inserting starter content). */
export function markdownToHtml(md: string): string {
  const esc = escapeHtml(md);
  const lines = esc.split(/\r?\n/);
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const inline = (t: string): string =>
    t
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"]+|\/[^)\s"]*)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, '$1');

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    const h3 = t.match(/^###\s+(.*)/);
    const h4 = t.match(/^####\s+(.*)/);
    const ulm = t.match(/^[-*]\s+(.*)/);
    const olm = t.match(/^\d+[.)]\s+(.*)/);
    const bq = t.match(/^&gt;\s?(.*)/);

    if (!t) {
      flushPara();
      closeList();
    } else if (h4) {
      flushPara(); closeList();
      out.push(`<h4>${inline(h4[1])}</h4>`);
    } else if (h3) {
      flushPara(); closeList();
      out.push(`<h3>${inline(h3[1])}</h3>`);
    } else if (t.match(/^#{1,2}\s+/)) {
      flushPara(); closeList();
      out.push(`<h3>${inline(t.replace(/^#{1,2}\s+/, ''))}</h3>`);
    } else if (bq) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
    } else if (ulm) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(ulm[1])}</li>`);
    } else if (olm) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(olm[1])}</li>`);
    } else {
      if (list) closeList();
      para.push(t);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}
