const STOP = new Set('a an the no such my me to for and of use what whats is are was were be been do does did can could would should please tell show get give about how next current latest now today leaving from with in on at it this that integration integrations api tool tools data information'.split(' '));
const TERMS: Record<string, string> = { trains: 'rail', train: 'rail', railway: 'rail', railways: 'rail', emails: 'mail', email: 'mail', departures: 'departure', arrivals: 'arrival', payments: 'payment', credits: 'credit', meetings: 'meeting', events: 'event' };
function tokens(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length > 1 && !STOP.has(w)).map(w => TERMS[w] ?? w))];
}
/** Token matches never confuse train with training or reward description length. */
export function rankCapabilities<T extends { name: string; description?: string; toolset?: string }>(tools: readonly T[], query: string, limit = 12): T[] {
  const q = query.trim().toLowerCase(); const words = tokens(q);
  return tools.map(tool => {
    const name = tool.name.toLowerCase(); const names = tokens(name);
    const body = tokens(`${tool.description ?? ''} ${tool.toolset ?? ''}`);
    const exact = name === q || name.replaceAll('_', ' ') === q;
    const score = exact ? 1000 : words.reduce((n, word) => n + (names.includes(word) ? 6 : body.includes(word) ? 2 : 0), 0);
    return { tool, score };
  }).filter(r => !q || r.score >= 2).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, Math.max(1, Math.min(limit, 100))).map(r => r.tool);
}
