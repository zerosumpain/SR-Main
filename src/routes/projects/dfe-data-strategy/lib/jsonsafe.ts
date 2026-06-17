// jsonsafe.ts — tolerant JSON extraction for LLM output. Handles: code fences, leading/
// trailing prose, truncation (max_tokens cutoff), and mid-structure syntax errors (e.g. a
// missing comma between array elements) by salvaging the largest valid prefix. Shared by the
// /consider and /suggest endpoints. Pure; safe anywhere.

/** Close any unclosed strings/brackets and strip a dangling trailing token/comma. */
function balance(text: string): string {
  let s = text.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';
  while (stack.length) s += stack.pop() === '{' ? '}' : ']';
  return s;
}

/** Best-effort parse of LLM JSON. Throws only if nothing salvageable. */
export function coerceJson<T = any>(raw: string): T {
  let s = (raw ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);

  // 1. straight parse
  try { return JSON.parse(s) as T; } catch { /* fall through */ }
  // 2. close truncation
  try { return JSON.parse(balance(s)) as T; } catch { /* fall through */ }
  // 3. salvage: cut at the reported syntax-error position, then re-balance. Repeat a few
  //    times in case there are several errors deeper in the structure.
  let cur = s;
  for (let i = 0; i < 6; i++) {
    let pos = -1;
    try {
      JSON.parse(cur);
    } catch (e: any) {
      const m = /position (\d+)/.exec(String(e?.message ?? ''));
      pos = m ? Number(m[1]) : -1;
    }
    if (pos < 0) break;
    const cut = balance(cur.slice(0, pos));
    try { return JSON.parse(cut) as T; } catch { cur = cut; }
  }
  throw new Error('unparseable JSON from model');
}
