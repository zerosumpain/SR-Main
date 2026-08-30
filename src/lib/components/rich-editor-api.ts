import type { ProseProposal } from '$lib/blog/assistant/proposal';

/**
 * Imperative API surface exposed by RichEditor.svelte via `bind:api`.
 * Lives in a standalone module so consumers can import the type without
 * pulling the component (Svelte instance-script types are not importable).
 */
export interface RichEditorApi {
  getHTML: () => string;
  getText: () => string;
  /** Wrap the first occurrence of `snippet` in an inline link. Returns true if found. */
  linkSnippet: (snippet: string, url: string, title?: string) => boolean;
  /** Append a numbered footnote referencing `snippet`. Returns the footnote number. */
  addFootnote: (snippet: string, url: string, title?: string) => number;
  applyProposal: (p: ProseProposal) => boolean;
  acceptProposal: (id: string, modifiedText?: string) => boolean;
  rejectProposal: (id: string) => boolean;
  /** Strip ALL suggestion marks from the document, treating each one as a
   *  reject (delete insertions, unwrap deletions). Used by the Clear button. */
  clearAllSuggestions: () => void;
  /** Insert an already-uploaded asset at the cursor. Used by the media
   *  library, which reuses bytes that are already in the store rather than
   *  uploading them a second time. */
  insertMedia: (item: { url: string; mimeType: string; altText?: string | null }) => void;
  /** Replace the entire document content. Used after rollback. */
  setContent: (html: string) => void;
}
