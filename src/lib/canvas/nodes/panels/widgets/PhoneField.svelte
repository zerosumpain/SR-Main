<script lang="ts">
  let {
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  } = $props();

  // Basic country-code suggestions; users can still type freely.
  const codes = [
    { code: '+44', label: 'UK (+44)' },
    { code: '+1', label: 'US/CA (+1)' },
    { code: '+33', label: 'FR (+33)' },
    { code: '+49', label: 'DE (+49)' },
    { code: '+34', label: 'ES (+34)' },
    { code: '+39', label: 'IT (+39)' },
    { code: '+61', label: 'AU (+61)' },
    { code: '+353', label: 'IE (+353)' },
  ];

  function parseValue(v: string): { code: string; rest: string } {
    if (!v) return { code: '+44', rest: '' };
    const m = v.trim().match(/^(\+\d{1,4})\s*(.*)$/);
    if (m) return { code: m[1], rest: m[2] ?? '' };
    return { code: '+44', rest: v.trim() };
  }

  const parts = $derived(parseValue(value));

  function setCode(code: string) {
    onChange((code + ' ' + parts.rest).trim());
  }
  function setRest(rest: string) {
    onChange((parts.code + ' ' + rest).trim());
  }
</script>

<div class="phone">
  <select value={parts.code} onchange={(e) => setCode((e.currentTarget as HTMLSelectElement).value)}>
    {#each codes as c (c.code)}
      <option value={c.code}>{c.label}</option>
    {/each}
  </select>
  <input
    type="tel"
    inputmode="tel"
    placeholder="7359 228511"
    value={parts.rest}
    oninput={(e) => setRest((e.currentTarget as HTMLInputElement).value)}
  />
</div>

<style>
  .phone { display: grid; grid-template-columns: minmax(0, 110px) 1fr; gap: 4px; }
  select, input { padding: 6px 8px; background: var(--bg); color: var(--text-primary); border: 1px solid var(--card-border); font: inherit; outline: none; }
</style>
