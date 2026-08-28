# Intel Graph Entity Relationships — Investigation Guide

## When to use this reference

Load this when the user asks about **why two entities in their intel graph are connected**, especially when the entities sit in different clusters and share little context. The question pattern is: "X and Y are connected in my graph but don't seem related — what's the real relationship?"

## The core insight

**Entity connections in the intel graph are often source-proximity artifacts, not meaningful real-world relationships.** The intel system extracts entities from source documents (emails, web pages, scraped content) and links them when they co-occur in the same source. Two entities can be linked because they appeared in the same document, even if they have no semantic connection.

The most common scenario: a single news article, email, or web page mentions both entity A and entity B in passing. The intel system extracts both and draws an edge between them. The edge means "these appeared together" — not "these are related."

## Investigation approach

### Step 1 — Get the entity descriptions

The user often has the entity descriptions from their graph view. If not, use `knowledge_search` with the entity names to surface what's known about each one.

### Step 2 — Search for real-world connections

Use `web_search` with the entity names together. Try:
- Plain query: `"entity A" "entity B"`
- Domain-specific: `"entity A" "entity B" relationship`
- Contextual: try variations that might explain a connection

### Step 3 — Knowledge search in the user's stores

Use `knowledge_search` to check if the entities appear together in any of the user's own files, notes, or research materials. This can reveal the source document.

### Step 4 — Triangulate the source

If the entities are from different domains (e.g. a food delivery promotion and a former PM), the likeliest source is a cost-of-living, politics, or consumer news article that happened to mention both. Look for a common context that would explain the co-occurrence.

### Step 5 — Explain the artifact

If no real-world connection is found, the answer is:
- **The connection is likely a source-proximity artifact** — both entities were extracted from the same source document, and the intel system linked them by co-occurrence
- **This is not a meaningful semantic relationship** — they belong in different clusters because they're from different domains
- **The user can break the edge** if they want cleaner cluster separation, or keep it as a breadcrumb back to the original source

## Common patterns

| Entity types | Likely co-occurrence context |
|---|---|
| Political figure + commercial promotion | Cost-of-living article, news roundup |
| Politician + food delivery | Food poverty / Multibank / cost-of-living piece |
| Historical figure + modern service | "Then vs now" or nostalgia article |
| Celebrity + niche brand | General news roundup, listicle |
| Two unrelated people | Same news event, byline, or shared article |

## Key phrasing to use

- **"Source-proximity artifact"** — the connection exists because both entities appeared in the same source document
- **"Co-occurrence link, not a causal or meaningful one"** — the edge means "these appeared together," not "these are related"
- **"Different clusters for a reason"** — they belong in different domains; the graph got it right
- **"Weak link polluting the cluster separation"** — when recommending breaking the edge

## Pitfalls

- **Don't over-invest in searches.** If 3-4 web searches don't find a connection, more won't help. The answer is the artifact hypothesis.
- **Don't fabricate a connection.** Saying "I can't find a real-world relationship" is the correct answer. Don't make one up.
- **Don't assume the user's data is wrong.** The intel graph's entity extraction is doing its job — it's finding co-occurrence. The question is whether the co-occurrence is meaningful.
- **Don't suggest the graph is broken.** It's working as designed. Edges are co-occurrence signals, not RDF-style semantic triples.