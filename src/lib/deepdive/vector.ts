/**
 * Serialize a numeric embedding into a pgvector string literal.
 *
 * Validates that every element is a finite number before emitting the string,
 * so a malformed embedding (e.g. from a compromised upstream API) cannot
 * inject characters into a raw SQL fragment.
 */
export function toVectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding: expected non-empty number array');
  }
  for (const v of embedding) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('Invalid embedding: non-finite value in vector');
    }
  }
  return `[${embedding.join(',')}]`;
}
