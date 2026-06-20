<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  let { data } = $props();

  type EmailConfig = {
    provider?: 'smtp' | 'resend' | 'postmark';
    from?: string;
    providerConfig?: Record<string, unknown>;
    allowedRecipients?: string[];
  };

  const initialConfig = (data.channel.config || {}) as EmailConfig;

  let channelName: string = $state(data.channel.name || '');
  let enabled: boolean = $state(Boolean(data.channel.enabled));
  let provider: 'smtp' | 'resend' | 'postmark' = $state((initialConfig.provider as any) || 'smtp');
  let fromAddress: string = $state(initialConfig.from || '');
  let providerConfigJson: string = $state(
    initialConfig.providerConfig ? JSON.stringify(initialConfig.providerConfig, null, 2) : '{}',
  );
  let allowedRecipientsText: string = $state(
    Array.isArray(initialConfig.allowedRecipients) ? initialConfig.allowedRecipients.join('\n') : '',
  );

  let saving = $state(false);
  let saveError: string | null = $state(null);
  let saveSuccess = $state(false);

  let testTo = $state('');
  let testSubject = $state('Test email from JKAI');
  let testBody = $state('This is a test message.');
  let testSending = $state(false);
  let testResult: { sent: boolean; error?: string } | null = $state(null);

  async function save() {
    saving = true;
    saveError = null;
    saveSuccess = false;
    try {
      let providerConfig: Record<string, unknown> = {};
      try {
        providerConfig = JSON.parse(providerConfigJson || '{}');
      } catch (err) {
        saveError = `Invalid JSON in provider config: ${err instanceof Error ? err.message : 'parse error'}`;
        return;
      }
      const allowedRecipients = allowedRecipientsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch(`/api/channels/${data.channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: channelName,
          enabled,
          config: { provider, from: fromAddress, providerConfig, allowedRecipients },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        saveError = err.error || `Save failed (${res.status})`;
        return;
      }
      saveSuccess = true;
    } finally {
      saving = false;
    }
  }

  async function sendTest() {
    testSending = true;
    testResult = null;
    try {
      const res = await fetch(`/api/channels/${data.channel.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo, subject: testSubject, message: testBody }),
      });
      testResult = await res.json();
    } catch (err) {
      testResult = { sent: false, error: err instanceof Error ? err.message : 'Send failed' };
    } finally {
      testSending = false;
    }
  }
</script>

<svelte:head>
  <title>{data.channel.name} — Channels</title>
</svelte:head>

<PageHeader title={(data.channel.name || 'EMAIL CHANNEL').toString().toUpperCase()} titleHref="/jkai/channels" />

<div class="p-6 sm:p-10 max-w-3xl mx-auto">
  <div class="mb-6">
    <p class="text-sm" style="color: var(--text-secondary);">Email channel configuration.</p>
  </div>

  <div
    class="mb-4 px-4 py-3 rounded-[var(--radius-round)] border text-xs"
    style="background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn);"
  >
    Sending not yet wired up — configuration saved only. The email send implementation lands in a follow-up PR.
  </div>

  <div
    class="p-5 rounded-[var(--radius-round)] border space-y-4"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Channel name
      </label>
      <input
        type="text"
        bind:value={channelName}
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      />
    </div>

    <div class="flex items-center gap-2">
      <input id="email-enabled" type="checkbox" bind:checked={enabled} />
      <label for="email-enabled" class="text-xs" style="color: var(--text-secondary);">Enabled</label>
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Provider
      </label>
      <select
        bind:value={provider}
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      >
        <option value="smtp">SMTP</option>
        <option value="resend">Resend</option>
        <option value="postmark">Postmark</option>
      </select>
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        From address
      </label>
      <input
        type="text"
        bind:value={fromAddress}
        placeholder="jkai@example.com"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      />
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Provider config (JSON)
      </label>
      <textarea
        bind:value={providerConfigJson}
        rows="6"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      ></textarea>
      <p class="text-[10px] mt-1" style="color: var(--text-ghost);">
        e.g. for SMTP: &#123;"host":"smtp.example.com","port":587,"user":"...","pass":"..."&#125;
      </p>
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1.5 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Allowed recipients (one per line — blank = any)
      </label>
      <textarea
        bind:value={allowedRecipientsText}
        rows="3"
        class="w-full px-2 py-1.5 rounded text-xs border"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      ></textarea>
    </div>

    {#if saveError}
      <div class="text-xs px-3 py-2 rounded border" style="border-color: var(--error); color: var(--error);">
        {saveError}
      </div>
    {/if}
    {#if saveSuccess}
      <div class="text-xs px-3 py-2 rounded border" style="border-color: var(--success); color: var(--success);">
        Saved.
      </div>
    {/if}

    <button
      onclick={save}
      disabled={saving}
      class="w-full px-3 py-2 rounded text-sm font-medium"
      style="background: var(--accent); color: white; opacity: {saving ? 0.7 : 1};"
    >{saving ? 'Saving...' : 'Save Settings'}</button>
  </div>

  <div
    class="mt-6 p-5 rounded-[var(--radius-round)] border space-y-3"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    <h2 class="text-sm font-medium" style="color: var(--text-primary);">Send test email</h2>
    <p class="text-[11px]" style="color: var(--text-ghost);">
      This is a stub — the request will always return &#123;sent: false&#125; until the email sender is implemented.
    </p>
    <input
      type="text"
      bind:value={testTo}
      placeholder="to@example.com"
      class="w-full px-2 py-1.5 rounded text-xs border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    />
    <input
      type="text"
      bind:value={testSubject}
      placeholder="Subject"
      class="w-full px-2 py-1.5 rounded text-xs border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    />
    <textarea
      bind:value={testBody}
      rows="4"
      class="w-full px-2 py-1.5 rounded text-xs border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    ></textarea>
    <button
      onclick={sendTest}
      disabled={testSending}
      class="w-full px-3 py-2 rounded text-sm font-medium border"
      style="border-color: var(--card-border); color: var(--text-secondary); background: transparent; opacity: {testSending ? 0.6 : 1};"
    >{testSending ? 'Sending...' : 'Send test email'}</button>

    {#if testResult}
      <div
        class="text-xs px-3 py-2 rounded border"
        style="border-color: {testResult.sent ? 'var(--success)' : 'var(--error)'}; color: {testResult.sent ? 'var(--success)' : 'var(--error)'};"
      >
        {#if testResult.sent}
          Sent.
        {:else}
          {testResult.error || 'Not sent'}
        {/if}
      </div>
    {/if}
  </div>
</div>
