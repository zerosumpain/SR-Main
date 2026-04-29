// Flesch Reading Ease & Flesch–Kincaid Grade Level.
// Pure functions; safe in browser and server.

export interface ReadabilityScores {
  words: number;
  sentences: number;
  syllables: number;
  /** 0–100; higher = easier. ~60 is plain English. */
  fleschReadingEase: number;
  /** US grade level. ~8 ~ 13yo. */
  fleschKincaidGrade: number;
  /** Short human-readable interpretation of the FRE score. */
  audience: string;
}

const EMPTY: ReadabilityScores = {
  words: 0,
  sentences: 0,
  syllables: 0,
  fleschReadingEase: 0,
  fleschKincaidGrade: 0,
  audience: '—',
};

export function plainTextFromHtml(html: string): string {
  if (!html) return '';
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.innerHTML = html;
    // Drop code blocks — they skew the metric and aren't prose.
    div.querySelectorAll('pre, code').forEach((el) => el.remove());
    return div.textContent ?? '';
  }
  return html
    .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function countSyllablesInWord(raw: string): number {
  const word = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;

  // Drop trailing silent 'e' (but not 'le' endings).
  let w = word;
  if (w.endsWith('e') && !w.endsWith('le')) w = w.slice(0, -1);

  // Drop trailing 'es' / 'ed' (but not 'ted'/'ded').
  if (w.endsWith('es') || (w.endsWith('ed') && !/[td]ed$/.test(w))) {
    w = w.slice(0, -2) || w;
  }

  const groups = w.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function countSyllables(text: string): number {
  let total = 0;
  for (const tok of text.split(/\s+/)) {
    if (!tok) continue;
    total += countSyllablesInWord(tok);
  }
  return total;
}

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // A "sentence" boundary is one or more terminal punctuation chars
  // followed by whitespace or end of string.
  const matches = trimmed.match(/[.!?]+(?=\s|$)/g);
  if (matches && matches.length > 0) return matches.length;
  return 1; // a non-empty string with no terminator still counts as one sentence
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function audienceLabel(fre: number): string {
  if (fre >= 90) return 'Very easy · 5th-grade reader';
  if (fre >= 80) return 'Easy · 6th-grade reader';
  if (fre >= 70) return 'Fairly easy · 7th-grade reader';
  if (fre >= 60) return 'Plain English · 8–9th-grade';
  if (fre >= 50) return 'Fairly difficult · 10–12th-grade';
  if (fre >= 30) return 'Difficult · college reader';
  return 'Very difficult · graduate reader';
}

export function readability(text: string): ReadabilityScores {
  const words = countWords(text);
  const sentences = countSentences(text);
  if (!words || !sentences) return EMPTY;

  const syllables = countSyllables(text);
  const wordsPerSentence = words / sentences;
  const syllablesPerWord = syllables / words;

  const fre = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    words,
    sentences,
    syllables,
    fleschReadingEase: round1(Math.max(0, Math.min(120, fre))),
    fleschKincaidGrade: round1(Math.max(0, grade)),
    audience: audienceLabel(fre),
  };
}
