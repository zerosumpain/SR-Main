<script lang="ts">
  let { data, fontSize = '10px' }: { data: unknown; fontSize?: string } = $props();

  interface Token {
    kind: 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'ws';
    text: string;
  }

  // Match one JSON token at a time. The order matters — strings first, then
  // numbers, then literals, then punctuation, then whitespace.
  const RE = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]|\s+/g;

  function tokenize(json: string): Token[] {
    const out: Token[] = [];
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    let lastIdx = 0;
    while ((m = RE.exec(json))) {
      // Handle any gap as raw text (shouldn't happen for valid JSON, but be safe)
      if (m.index > lastIdx) {
        out.push({ kind: 'punct', text: json.slice(lastIdx, m.index) });
      }
      const raw = m[0];
      if (/^\s+$/.test(raw)) {
        out.push({ kind: 'ws', text: raw });
      } else if (raw.startsWith('"')) {
        // Look ahead past whitespace: if next non-ws char is ':' it's a key
        let i = RE.lastIndex;
        while (i < json.length && /\s/.test(json[i])) i++;
        const isKey = json[i] === ':';
        out.push({ kind: isKey ? 'key' : 'string', text: raw });
      } else if (raw === 'true' || raw === 'false') {
        out.push({ kind: 'bool', text: raw });
      } else if (raw === 'null') {
        out.push({ kind: 'null', text: raw });
      } else if (/^-?\d/.test(raw)) {
        out.push({ kind: 'number', text: raw });
      } else {
        out.push({ kind: 'punct', text: raw });
      }
      lastIdx = RE.lastIndex;
    }
    if (lastIdx < json.length) {
      out.push({ kind: 'punct', text: json.slice(lastIdx) });
    }
    return out;
  }

  let tokens = $derived.by(() => {
    try {
      const json = JSON.stringify(data, null, 2) ?? 'undefined';
      return tokenize(json);
    } catch {
      // Data has circular refs or similar — fall back to String()
      return [{ kind: 'string' as const, text: String(data) }];
    }
  });
</script>

<pre class="json-block" style="--fs: {fontSize};">{#each tokens as t}<span class={t.kind}>{t.text}</span>{/each}</pre>

<style>
  .json-block {
    font-family: var(--font-mono);
    font-size: var(--fs, 10px);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    margin: 0;
    padding: 0.5rem 0.6rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--card-border) 30%, transparent);
    color: var(--text-primary);
  }
  .key    { color: var(--accent); }
  .string { color: #3f6f45; } /* deep leafy green, reads on cream */
  .number { color: #7a3e9d; } /* plum */
  .bool   { color: #a0550a; font-weight: 500; }
  .null   { color: var(--text-ghost); font-style: italic; }
  .punct  { color: var(--text-muted); }
  .ws     { color: inherit; }
</style>
