/** Provider-qualified model ids (`z-ai/glm-5.2`, `anthropic/claude-haiku-4-5`)
 *  are too long for a chip or a rail row. Everything after the last slash is
 *  the part that identifies the model to a reader. */
export function shortModelLabel(id: string | null | undefined): string {
  if (!id) return '';
  return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
}
