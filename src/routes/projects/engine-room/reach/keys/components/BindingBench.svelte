<script lang="ts">
  // BindingBench — aim a credential at a target and watch four gates decide.
  //
  // The instrument is the decision itself, in the order the real resolver applies it, because
  // the order is load-bearing: a store-only credential is refused before any of the binding
  // arithmetic, or the whole credential set would be pasted into a header on the way to
  // finding out it should not have been.
  //
  // Every refusal shows the actual reason and the actual list, so the answer is never "no"
  // on its own.
  import { CREDENTIALS, TARGETS, CHECKS } from '../../../lib/keys';

  let cred = $state(CREDENTIALS[0].handle);
  let target = $state(TARGETS[0].id);
  let redirect = $state(false);

  const c = $derived(CREDENTIALS.find((x) => x.handle === cred) ?? CREDENTIALS[0]);
  const t = $derived(TARGETS.find((x) => x.id === target) ?? TARGETS[0]);

  /** Sub-domains only — never the apex, and never a bare star. */
  function hostMatches(host: string, pattern: string): boolean {
    if (!pattern || pattern === '*') return false;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  }

  /** Where a redirect would land: same host, an endpoint outside any path scope. */
  const hop = $derived(redirect ? { host: t.host, path: '/v1/anything-else', method: t.method } : null);
  const finalTarget = $derived(hop ?? t);

  const verdicts = $derived.by(() => {
    const out: Array<{ id: string; pass: boolean; say: string }> = [];
    const push = (id: string, pass: boolean, say: string) => out.push({ id, pass, say });

    if (c.storeOnly) {
      push('kind', false, 'This credential is store-only. It is never attached to a request, so the resolver stops here.');
      return out;
    }
    push('kind', true, `Attached as ${c.injection}.`);

    const hostOk = c.hosts.some((h) => hostMatches(finalTarget.host, h));
    push('host', hostOk,
      hostOk
        ? `${finalTarget.host} is covered by ${c.hosts.join(', ')}.`
        : `Bound to ${c.hosts.join(', ')}, and will not be sent to ${finalTarget.host}.`);
    if (!hostOk) return out;

    const pathOk = c.paths.length === 0 || c.paths.some((p) => finalTarget.path.startsWith(p));
    push('path', pathOk,
      c.paths.length === 0
        ? 'No path narrowing set, so the whole host is in scope.'
        : pathOk
          ? `${finalTarget.path} is under ${c.paths.join(', ')}.`
          : `Scoped to ${c.paths.join(', ')} on this host, and will not be sent to ${finalTarget.path}.`);
    if (!pathOk) return out;

    const methodOk = c.methods.includes(finalTarget.method);
    push('method', methodOk,
      methodOk
        ? `${finalTarget.method} is one of ${c.methods.join(', ')}.`
        : `May only authenticate ${c.methods.join('/')} requests, not ${finalTarget.method}.`);
    return out;
  });

  const sent = $derived(verdicts.length === CHECKS.length && verdicts.every((v) => v.pass));
  const stoppedAt = $derived(verdicts.find((v) => !v.pass) ?? null);
  const labelOf = (id: string) => CHECKS.find((k) => k.id === id)?.label ?? id;
</script>

<div class="bb">
  <div class="pickers">
    <div class="pick">
      <span class="k" id="bb-cred">The credential</span>
      <div class="row" role="group" aria-labelledby="bb-cred">
        {#each CREDENTIALS as x (x.handle)}
          <button type="button" class:on={cred === x.handle} class:store={x.storeOnly}
                  aria-pressed={cred === x.handle} onclick={() => (cred = x.handle)}>{x.label}</button>
        {/each}
      </div>
    </div>
    <div class="pick">
      <span class="k" id="bb-target">Aimed at</span>
      <div class="row" role="group" aria-labelledby="bb-target">
        {#each TARGETS as x (x.id)}
          <button type="button" class:on={target === x.id} aria-pressed={target === x.id}
                  onclick={() => (target = x.id)}>{x.label}</button>
        {/each}
      </div>
    </div>
  </div>

  <label class="hop">
    <input type="checkbox" bind:checked={redirect} />
    <span>…and it answers with a redirect to another endpoint on the same host</span>
  </label>

  <div class="url">
    <span class="u-m">{finalTarget.method}</span>
    <code>{finalTarget.host}{finalTarget.path}</code>
    {#if hop}<span class="u-hop">after one hop</span>{/if}
  </div>

  <ol class="gates">
    {#each CHECKS as check (check.id)}
      {@const v = verdicts.find((x) => x.id === check.id)}
      <li class:pass={v?.pass} class:fail={v && !v.pass} class:idle={!v}>
        <span class="g-mark" aria-hidden="true">{v ? (v.pass ? '✓' : '✕') : '·'}</span>
        <span class="g-lab">{check.label}</span>
        <span class="g-say">{v ? v.say : 'not reached'}</span>
      </li>
    {/each}
  </ol>

  <p class="verdict" class:no={!sent} aria-live="polite">
    {#if sent}
      <b>Sent.</b> The value is attached at the last moment, on this one request, and stripped back out
      of the response before anything reads it.
    {:else}
      <b>Refused at “{labelOf(stoppedAt?.id ?? 'kind')}”.</b> {stoppedAt?.say}
      Widening it is something only the owner can do, by hand.
    {/if}
  </p>

  <p class="cred-note">{c.note}</p>
</div>

<style>
  .bb { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
  .k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--success); }

  .pickers { display: flex; flex-direction: column; gap: 9px; }
  .row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
  .row button { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .row button:hover { background: rgba(28,22,17,0.07); }
  .row button.on { background: var(--success); border-color: var(--success); color: #fff; }
  .row button.store { border-style: dashed; }

  .hop { display: flex; align-items: center; gap: 7px; font-size: 12px; color: rgba(28,22,17,0.7); cursor: pointer; }
  .hop input { accent-color: var(--success); }

  .url { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    padding: 8px 12px; border-radius: var(--radius-round); background: rgba(28,22,17,0.05);
    border: 1px solid rgba(28,22,17,0.12); }
  .u-m { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.08em;
    padding: 2px 7px; border-radius: var(--radius-pill); background: rgba(28,22,17,0.1); color: rgba(28,22,17,0.65); }
  .url code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-primary);
    overflow-wrap: anywhere; }
  .u-hop { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent); margin-left: auto; }

  .gates { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
  .gates li { display: grid; grid-template-columns: 20px minmax(140px, 190px) 1fr; gap: 9px;
    align-items: baseline; padding: 6px 10px; border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); border-left: 3px solid transparent; }
  .gates li.pass { border-left-color: var(--success); }
  .gates li.fail { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .gates li.idle { opacity: 0.45; }
  .g-mark { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(28,22,17,0.3); }
  .gates li.pass .g-mark { color: var(--success); }
  .gates li.fail .g-mark { color: #8a2d3a; }
  .g-lab { font-size: 12.5px; color: var(--text-primary); }
  .g-say { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); }

  .verdict { margin: 0; padding: 9px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent);
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 90ch; }
  .verdict.no { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .verdict b { color: var(--text-primary); }

  .cred-note { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.6); max-width: 88ch; }

  @media (max-width: 620px) {
    .gates li { grid-template-columns: 20px 1fr; }
    .g-say { grid-column: 2 / -1; }
    .u-hop { margin-left: 0; }
  }
</style>
