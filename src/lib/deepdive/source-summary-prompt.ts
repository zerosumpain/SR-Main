// src/lib/deepdive/source-summary-prompt.ts
//
// Pure function: build the LLM prompt for a "page summary" from DB rows.
// No I/O — testable in isolation.

export interface SourceRow {
  id: string;
  url: string;
  title?: string | null;
  snippet?: string | null;
  domain?: string | null;
}

export interface FactRow {
  id: string;
  content: string;
}

export interface SummaryPromptResult {
  system: string;
  user: string;
}

/**
 * Build the system + user prompt from live page text (fetched at summary time).
 * Preferred over the stored-facts path when real page text is available.
 */
export function buildPageTextSummaryPrompt(
  source: SourceRow,
  pageText: string,
): SummaryPromptResult {
  const system =
    'You are a concise research assistant. Summarise what a web page says ' +
    'based only on the page text provided — do NOT make up new facts. ' +
    'Write 2–4 plain prose sentences suitable for a research card. ' +
    'No bullet points, no markdown, no hedging preamble.';

  const titleLine = source.title ? `Title: ${source.title}` : `URL: ${source.url}`;
  const domainLine = source.domain ? `Domain: ${source.domain}` : '';

  const user = [
    titleLine,
    domainLine,
    '',
    'Page text:',
    pageText,
    '',
    'Write a 2–4 sentence summary of what this page covers.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  return { system, user };
}

/**
 * Build the system + user prompt for summarising a source from already-gathered
 * data (facts extracted from it + its title/snippet). No live fetch.
 *
 * When `facts` is empty, falls back to the snippet/title alone.
 * This is the fallback path when live page text is unavailable (method === 'none').
 */
export function buildSourceSummaryPrompt(
  source: SourceRow,
  facts: FactRow[],
): SummaryPromptResult {
  const system =
    'You are a concise research assistant. Summarise what a web page says ' +
    'based only on the information provided — do NOT make up new facts. ' +
    'Write 2–4 plain prose sentences suitable for a research card. ' +
    'No bullet points, no markdown, no hedging preamble.';

  const titleLine = source.title ? `Title: ${source.title}` : `URL: ${source.url}`;
  const domainLine = source.domain ? `Domain: ${source.domain}` : '';

  if (facts.length === 0) {
    // Graceful fallback: summarise from snippet/title only.
    const snippetLine = source.snippet
      ? `Snippet: ${source.snippet}`
      : '(No snippet available.)';
    const user = [
      titleLine,
      domainLine,
      snippetLine,
      '',
      'No extracted facts are available for this page. ' +
        'Write a 1–2 sentence summary based on the title and snippet alone, ' +
        'or note that there is insufficient content to summarise.',
    ]
      .filter(Boolean)
      .join('\n');
    return { system, user };
  }

  const bulletList = facts.map((f, i) => `${i + 1}. ${f.content}`).join('\n');

  const snippetSection = source.snippet
    ? `\nPage snippet: ${source.snippet}\n`
    : '';

  const user = [
    titleLine,
    domainLine,
    snippetSection,
    `Extracted facts (${facts.length}):`,
    bulletList,
    '',
    'Write a 2–4 sentence summary of what this page covers, drawing on the facts above.',
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  return { system, user };
}
