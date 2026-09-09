import type { Artefact } from './contracts';

// Keeping the policy document out of the search box.
//
// Research queries are composed by the model and sent to a third-party search
// API. The prompt tells it to write "a bounded public web search query, without
// document quotes" — and a prompt is not a control. An unpublished policy paper
// is exactly the kind of document whose distinctive phrases must not turn up in
// somebody else's query logs.
//
// So the overlap is measured rather than requested: if any run of
// `WINDOW` consecutive words in the query also appears in the extracted text,
// the query is a quotation and the question is dropped with a visible warning.
// Short factual queries about a named body — "Regulator of Social Housing
// enforcement powers" — carry no such run and pass.

const WINDOW = 6;

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

function shingles(text: string, window: number): Set<string> {
  const list = words(text);
  const out = new Set<string>();
  for (let i = 0; i + window <= list.length; i++) out.add(list.slice(i, i + window).join(' '));
  return out;
}

/** Everything a query may not contain, built once per stage from the passages. */
export function documentShingles(artefacts: Artefact[]): Set<string> {
  const out = new Set<string>();
  for (const passage of artefacts) {
    if (passage.kind !== 'passage') continue;
    for (const s of shingles(passage.statement, WINDOW)) out.add(s);
  }
  return out;
}

/** True when the query reproduces a run of the document verbatim. */
export function quotesDocument(query: string, corpus: Set<string>): boolean {
  if (!corpus.size) return false;
  for (const s of shingles(query, WINDOW)) if (corpus.has(s)) return true;
  return false;
}
