---
name: jkai-files
description: "Find, read and cite files in Drive using semantic search or exact IDs, respecting content and access limits."
---

# jkai-files

Use `file_search` for questions about content, including @files requests.
Use `file_list` for names or folders, then `file_read` with an exact returned ID.
Apply folder prefixes and limits rather than fetching the whole vault.

Answer from the returned text and name or link the source beside each claim.
If a file is truncated, read the relevant indexed passages and make that limit
clear. Do not infer a document's contents from its filename alone.

For large documents, use `knowledge_search` after checking its current schema
with `tool_describe`; search separate facets and preserve their provenance.
If extraction or indexing fails, report that failure rather than invent content.

Users upload and manage files through `/drive`. Generated documents use
`write_document` when available. Reading a file does not authorize changing its
sharing, deleting it or exposing private contents to another user.
