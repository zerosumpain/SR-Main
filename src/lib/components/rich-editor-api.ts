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
  /**
   * Cite `snippet` against `url`: a subtle superscript marker where the claim
   * is, and an entry in the post's references block.
   *
   * Replaces `addFootnote`, which appended `<hr><h3>Sources</h3>` and a list of
   * raw URLs to the BODY — the loudest thing on the finished page. The
   * references block is lifted into the article footer at render time; see
   * $lib/blog/references. Returns the citation number.
   */
  addReference: (snippet: string, url: string, title?: string) => number;
  /** The post's current citations, for the editor's Sources panel. */
  listReferences: () => { n: number; url: string; title: string }[];
  /** Drop one citation and its marker. Returns true if it was there. */
  removeReference: (n: number) => boolean;
  /**
   * Edit what a citation SAYS in the footer — its title, its URL, or both.
   *
   * The footer text comes from a search result's own `<title>`, which is
   * frequently a slug, a truncated headline or a site name repeated twice.
   * The author has to be able to fix it, and cannot type into the block
   * directly: the references node is an atom precisely because the `fn-` ids
   * are what the prose markers link to. This is the way in.
   *
   * The number is not editable — it is the link target.
   */
  updateReference: (n: number, patch: { title?: string; url?: string }) => boolean;
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
