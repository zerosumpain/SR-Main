# Multi-Query Facet Extraction for Large Vault Documents

## The problem

`file_read` sometimes fails on vault documents — the extended tool resolves paths against
a stale workflow-files directory (`~/.openclaw/workflow-files/...`) and returns ENOENT for
files that exist in the vault but weren't uploaded through that path. Large DOCX/PPTX/PDF
files (500KB+) are also impractical to read in full: the extracted text can be hundreds of
thousands of characters, and `file_read` truncates or fails.

## The technique

Use `mcp_jkai_knowledge_search` with `sources: ["files"]` to semantic-search *inside* the
document's indexed chunks. Each hit returns a `passage` — a semantically coherent chunk of
the document with its `charStart`/`charEnd` offsets and `chunkOrd` position. By running
multiple parallel queries with different facet terms, you can reconstruct the document's
content across its key themes without ever reading the whole file.

### When to use

- `file_read` returns ENOENT or a path error for a vault file.
- The file is large (500KB+) and you need specific sections, not the full text.
- The user asks you to "dig into" or explore a document already in the vault.
- You need to answer a question about a document's content across multiple themes.

### How

1. **Identify the file.** Use a broad `knowledge_search` (no source filter) or
   `file_list` to find the document by name/topic. Note its `fileId`.

2. **Run parallel facet queries.** Issue 2–4 `knowledge_search` calls simultaneously,
   each with `sources: ["files"]`, `limitPerSource: 10–15`, and a different query
   targeting a specific theme/section of the document. Example from a national
   implementation survey document:

   ```
   knowledge_search(query="X-Road NIIS Estonia brokered exchange", sources=["files"], limitPerSource=15)
   knowledge_search(query="Netherlands catalogue India consent Matrix trust framework", sources=["files"], limitPerSource=15)
   knowledge_search(query="NHS Spine Secure Data Environments compute-to-data", sources=["files"], limitPerSource=15)
   ```

3. **Assemble from passages.** Each hit's `passage` text is a chunk of the document.
   Hits are ranked by relevance score and include `chunkOrd` (chunk sequence number)
   and `charStart`/`charEnd` offsets — use these to mentally order passages and detect
   gaps. Deduplicate overlapping passages across queries.

4. **Drill deeper if needed.** If a facet is thin, run a follow-up query with more
   specific terms (e.g. "OpenSAFELY analysis travels to data fan out 24000 schools"
   rather than "OpenSAFELY compute-to-data").

### Advantages over file_read

- **Works when file_read fails** — the knowledge index is populated at upload time
  and doesn't depend on the file existing at a specific filesystem path.
- **Selective** — you get the relevant chunks, not 200KB of boilerplate.
- **Parallelisable** — multiple facets extracted in one tool-call round.
- **Theme-aware** — semantic search finds passages by meaning, not just keywords,
  so you can query "what does this document say about consent" and get the right
  chunks even if the word "consent" isn't used.

### Limitations

- You get chunks, not the full document — there may be gaps between retrieved passages.
- `limitPerSource` caps at ~20, so very large documents may need multiple rounds.
- The knowledge index covers the vault's embedded content; if a file was uploaded but
  not yet embedded (very recent), it won't appear.
- Passages are truncated at chunk boundaries — you may get partial sections.

## Session example

The user asked about "the data spine" and then to "dig into the national implementation
survey" and "what opensafely means for the data spine." The document
`federated-working-national-implementations.docx` (883KB) was in the vault. `file_read`
failed with ENOENT. Instead, three rounds of parallel `knowledge_search` calls with
`sources: ["files"]` extracted:

- Round 1: the seven archetypes (X-Road family, API-gateway, base-register, consent,
  peer-mesh, compute-to-data, identity federation) and the cross-cutting observations.
- Round 2: the specific national implementations (Estonia, Netherlands, India, Germany,
  UK NHS Spine, Singapore, Denmark, Belgium, etc.).
- Round 3: the OpenSAFELY compute-to-data model, the two-flow spine design (Flow A
  no-PII / Flow B rules-based PII release), and the connector architecture.

Each round produced 10–15 passages per query, which were assembled into a coherent
narrative covering the document's full argument without reading it end-to-end.
