import sanitize from 'sanitize-html';

const CHAT_OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'hr',
    'code', 'pre',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    code: ['class'],
    pre: ['class'],
    span: ['class'],
    div: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
  },
};

const NARRATIVE_OPTIONS: sanitize.IOptions = {
  allowedTags: ['em', 'strong', 'b', 'i'],
  allowedAttributes: {},
};

export function sanitizeChatHtml(html: string): string {
  return sanitize(html, CHAT_OPTIONS);
}

export function sanitizeNarrativeHtml(html: string): string {
  return sanitize(html, NARRATIVE_OPTIONS);
}
