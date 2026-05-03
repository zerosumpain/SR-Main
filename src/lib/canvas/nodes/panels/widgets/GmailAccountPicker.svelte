<script lang="ts">
  // Gmail account picker. Wraps ResourcePicker + the shared accounts
  // fetcher and handles the string<->number round-trip the executor
  // expects (accountId is numeric in the config but ResourcePicker
  // works with strings; templated values like `{{input.accountId}}`
  // round-trip as strings).
  //
  // Encapsulates the "⚠ pick an account" warning and the link to
  // /admin/gmail so panels don't each re-implement this section.

  import ResourcePicker from '../shared/ResourcePicker.svelte';
  import { fetchGmailAccountOptions } from '../shared/gmailAccounts';

  let {
    value,
    onChange,
    title = 'Sending account',
    label = 'Account',
    placeholder = 'pick an account',
    showAdminLink = true,
  }: {
    /** Raw config value: number id, templated string, or 0/'' when unset. */
    value: number | string | null | undefined;
    /** Called with the new accountId — number for ids, string for templates, 0 when cleared. */
    onChange: (next: number | string) => void;
    title?: string;
    label?: string;
    placeholder?: string;
    showAdminLink?: boolean;
  } = $props();

  const accountId = $derived(Number(value ?? 0));
  const accountValue = $derived(
    typeof value === 'string' && value.includes('{{')
      ? value
      : accountId ? String(accountId) : '',
  );

  function setAccount(next: string) {
    if (!next) { onChange(0); return; }
    if (next.includes('{{')) { onChange(next); return; }
    const n = Number(next);
    onChange(Number.isFinite(n) ? n : 0);
  }
</script>

<section class="gap-sec">
  <header class="gap-sec-hdr">
    <span class="sr-label-tight">{title}</span>
    {#if !accountId}<span class="gap-warn">⚠ pick an account</span>{/if}
  </header>
  <ResourcePicker
    {label}
    value={accountValue}
    fetcher={fetchGmailAccountOptions}
    onChange={setAccount}
    {placeholder}
    emptyHint="No connected accounts — connect one at /admin/gmail."
  />
  {#if showAdminLink}
    <span class="gap-hint">
      Manage connected accounts at
      <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
    </span>
  {/if}
</section>

<style>
  .gap-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gap-sec-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gap-warn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--status-error, #c0392b);
  }
  .gap-hint {
    font-size: 11px;
    color: var(--text-ghost);
  }
  .gap-hint a { color: var(--text-muted); }
</style>
