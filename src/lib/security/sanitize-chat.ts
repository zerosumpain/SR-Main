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

// Document/source PREVIEW profile. A superset of the chat profile for rendering a
// user's OWN uploaded document (docx via mammoth, pptx/xlsx generated HTML) or a
// research source's reader view. Unlike the chat profile it permits <img> — mammoth
// inlines document images as `data:` URIs — and table span attributes, but still
// forbids script/style/iframe/svg and any non-image scheme. Kept separate so the
// chat sanitiser (which guards untrusted LLM output) stays strict.
const PREVIEW_OPTIONS: sanitize.IOptions = {
  allowedTags: [
    ...(CHAT_OPTIONS.allowedTags as string[]),
    'img', 'figure', 'figcaption', 'caption', 'colgroup', 'col', 'section', 'article',
  ],
  allowedAttributes: {
    ...(CHAT_OPTIONS.allowedAttributes as Record<string, string[]>),
    // The pptx slide cards / xlsx tables carry structural class names the viewer's
    // scoped CSS targets; allow `class` on any tag (class names cannot inject — no
    // `style` attribute is permitted). Belongs to the preview profile only.
    '*': ['class'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    col: ['span'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Images may additionally be data: URIs (mammoth base64) — restricted to <img> only.
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
  },
};

export function sanitizeChatHtml(html: string): string {
  return sanitize(html, CHAT_OPTIONS);
}

export function sanitizeNarrativeHtml(html: string): string {
  return sanitize(html, NARRATIVE_OPTIONS);
}

export function sanitizePreviewHtml(html: string): string {
  return sanitize(html, PREVIEW_OPTIONS);
}
