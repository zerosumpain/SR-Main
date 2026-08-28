# Tool Description Patterns

Tool descriptions (the `description` field in `register()` calls in `src/lib/workflows/site-tools/`) are the primary signal an agent uses to decide which tool to call. The framing of a description determines whether a tool gets used or ignored.

## The Cardinal Rule: Lead with the Use Case, Not the Implementation

A tool description must answer "what will this do for me?" not "how does this work internally?"

### Bad — implementation-first

```
'What the intel graph has noticed on its own: brokers holding separate areas together, unexpected connections, links that probably exist. Pass a `query` to scope the analysis.'
```

The agent reads "what the graph has noticed" and categorises this as an analytics/insights tool. The `query` parameter reads as an afterthought. Result: the agent reaches for `knowledge_search` or `intel_find` instead, even though `intel_insights` with a query is the right tool.

### Good — use-case-first

```
'Find entities in the intel graph that are semantically related to a topic, plus any structural insights about them. Pass a `query` (e.g. "insurance", "John Kelly") to get the most relevant entities with their type, summary, and connection count, plus insights scoped to that topic.'
```

The agent reads "find entities semantically related to a topic" and immediately knows this is the tool for "tell me about X." The query parameter is the primary mechanism, not an afterthought.

## Parameter Descriptions: Signal When a Parameter Is the Primary Reason to Use the Tool

### Bad — optional framing

```
'Optional natural-language query to scope the analysis.'
```

The agent reads "optional" + "scope" and considers this a secondary filter. It won't reach for this tool when trying to find entities about a topic.

### Good — primary framing

```
'REQUIRED for topic-specific lookups: natural-language query for the entities you want. Uses semantic embeddings + name matching to find the most relevant entities, then returns them with their type, summary, connections, and any structural insights involving them.'
```

The agent reads "REQUIRED for topic-specific lookups" and treats the query as the main event. The parameter description tells the agent what it will get back, not just what the parameter does technically.

## When Adding a New Parameter to an Existing Tool

1. **Re-evaluate the tool description.** The old description was written for the old tool shape. The new parameter may change the primary use case. Rewrite the description to lead with the new capability.

2. **Don't append.** Adding "Pass a `query` to scope the analysis" to the end of an existing analytics description keeps the old framing dominant. The agent reads the first sentence and categorises the tool, ignoring the appended sentence.

3. **The parameter description is part of the tool pitch.** It's not just documentation — it's what convinces the agent to use this parameter. If the parameter is the primary way to use the tool, say so explicitly.

## Testing: Does the Description Work?

After writing a tool description, ask:

- "If I'm an agent looking for a way to find entities about X, would this description make me pick this tool?"
- "Does the first sentence tell me what the tool does for me, or how it works?"
- "If I removed every sentence after the first, would the tool still be picked correctly?"

## Examples from This Codebase

### intel_insights (fixed 2026-08-08)

**Before:** Implementation-first, query as afterthought
```
'What the intel graph has noticed on its own: brokers holding separate areas together, unexpected connections, links that probably exist but are not recorded, isolated clusters, entities going stale, and data-quality problems. Pass a `query` to scope the analysis to entities semantically related to a topic — returns both the matching entities and the insights about them.'
```

**After:** Use-case-first, query as primary mechanism
```
'Find entities in the intel graph that are semantically related to a topic, plus any structural insights about them (brokers, unexpected connections, missing links, emerging hubs, stale entities). Pass a `query` (e.g. "insurance", "home automation", "John Kelly") to get the most relevant entities with their type, summary, and connection count, plus insights scoped to that topic. Omit `query` for the full graph-wide analytics view. This is the primary tool for topic-specific graph enrichment — cheaper than chaining intel_find + intel_neighbourhood manually.'
```

### Parameter description

**Before:**
```
'Optional natural-language query to scope the analysis. Entities semantically related to this query are searched first, then insights are filtered to only those involving those entities. Omit for the full graph-wide view.'
```

**After:**
```
'REQUIRED for topic-specific lookups: natural-language query for the entities you want. Uses semantic embeddings + name matching to find the most relevant entities, then returns them with their type, summary, connections, and any structural insights involving them. Omit for the full graph-wide analytics view.'
```

## File: `src/lib/workflows/site-tools/tools/intel-graph.ts`