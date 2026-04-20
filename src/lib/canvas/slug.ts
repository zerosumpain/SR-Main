/** Turn free text into a canvas slug: lowercase, kebab, trimmed to 48 chars. */
export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48);
}
