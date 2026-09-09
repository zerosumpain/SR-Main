/** Optional SCIP JSON adapter. Indexers run outside the ingestion service. */
/** @param {any} index @param {string[]} files */
export function scipRelationships(index, files) {
  if (!index || !Array.isArray(index.documents) || index.documents.length > 30000) throw new Error('Invalid SCIP JSON index');
  const allowed = new Set(files); const definitions = new Map(); const references = [];
  for (const doc of index.documents) {
    const path = doc.relative_path ?? doc.relativePath;
    if (!allowed.has(path)) continue;
    for (const occurrence of doc.occurrences ?? []) {
      const symbol = occurrence.symbol;
      if (typeof symbol !== 'string' || symbol.startsWith('local ')) continue;
      if ((Number(occurrence.symbol_roles ?? occurrence.symbolRoles) & 1) !== 0) {
        definitions.set(symbol, [...new Set([...(definitions.get(symbol) ?? []), path])]);
      } else references.push({ path, symbol });
    }
  }
  const edges = [];
  for (const ref of references) for (const target of definitions.get(ref.symbol) ?? []) {
    if (target !== ref.path) edges.push({ source: ref.path, target, kind: 'references' });
  }
  return { edges: [...new Map(edges.map(e => [JSON.stringify(e), e])).values()], symbols: definitions.size,
    unresolved: references.filter(r => !definitions.has(r.symbol)).length, provider: 'SCIP' };
}
