<script lang="ts">
  // PermissionPrompt — the moment a phone asks. A drawn iPhone shows the system prompt for
  // each permission in the manifest in turn, with what the app uses it for as the reason.
  // Answering either way moves to the next one; nothing is recorded, it's a demonstration.
  // The drawing is SVG; the prompt's words and buttons are real HTML laid over it, so they
  // stay legible and reachable by keyboard.
  import PermIcon from './PermIcon.svelte';

  interface Props { items: Array<{ key: string; name: string; why: string }> }
  let { items }: Props = $props();

  let i = $state(0);
  let answers = $state<Record<string, 'allow' | 'deny'>>({});
  const cur = $derived(items[i % items.length]);
  function answer(a: 'allow' | 'deny') {
    answers = { ...answers, [cur.key]: a };
    i = (i + 1) % items.length;
  }
</script>

<div class="pp">
  <div class="device">
    <svg viewBox="0 0 320 600" aria-hidden="true">
      <defs><linearGradient id="pp-wall" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#f3ebdd" /><stop offset="1" stop-color="#e3d8c4" /></linearGradient></defs>
      <rect x="8" y="8" width="304" height="584" rx="54" fill="#241709" />
      <rect x="20" y="20" width="280" height="560" rx="44" fill="url(#pp-wall)" />
      <rect x="118" y="32" width="84" height="26" rx="13" fill="#000" />
      {#each Array(12) as _, n}<rect x={44 + (n % 4) * 62} y={96 + Math.floor(n / 4) * 74} width="46" height="46" rx="12" fill="rgba(26,16,8,0.1)" />{/each}
      <rect x="20" y="20" width="280" height="560" rx="44" fill="rgba(26,16,8,0.42)" />
      {#key i}<rect class="alert" x="42" y="170" width="236" height="276" rx="18" fill="#f3ebdd" />{/key}
      <line x1="42" y1="398" x2="278" y2="398" stroke="rgba(26,16,8,0.18)" />
      <line x1="160" y1="398" x2="160" y2="446" stroke="rgba(26,16,8,0.18)" />
    </svg>
    {#key i}
      <div class="ov" role="dialog" aria-label="Permission prompt">
        <span class="ic"><PermIcon name={cur.key} /></span>
        <b class="t">Allow the app {cur.name}?</b>
        <span class="w">It needs this to {cur.why}.</span>
        <div class="bt">
          <button onclick={() => answer('deny')}>Don’t allow</button>
          <button class="ok" onclick={() => answer('allow')}>Allow</button>
        </div>
      </div>
    {/key}
  </div>
  <ol class="dots" aria-label="Permissions">
    {#each items as it, n (it.key)}
      <li><button class:on={n === i % items.length} data-a={answers[it.key]} onclick={() => (i = n)} aria-label={it.name} title={it.name}></button></li>
    {/each}
  </ol>
</div>

<style>
  .pp { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .device { position: relative; width: min(320px, 100%); }
  svg { display: block; width: 100%; height: auto; }
  .alert { transform-box: fill-box; transform-origin: center; animation: pop 0.5s var(--er-ease) both; }
  @keyframes pop { from { opacity: 0; transform: scale(1.12); } }
  .ov { position: absolute; left: 13.1%; width: 73.8%; top: 28.3%; height: 46%; display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 18px 16px 0; box-sizing: border-box; color: #1a1008; animation: fade 0.5s 0.1s both; }
  @keyframes fade { from { opacity: 0; } }
  .ic { width: 40px; height: 40px; margin-bottom: 10px; --fg: #1a1008; --tone-text: var(--er-bronze-paper); }
  .t { font-family: var(--er-body); font-weight: 700; font-size: var(--fs-nav); line-height: 1.3; margin-bottom: 6px; text-transform: none; }
  .w { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(26, 16, 8, 0.72); }
  .bt { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr; width: calc(100% + 32px); height: 17.4%; min-height: 40px; }
  .bt button { background: none; border: none; cursor: pointer; font-family: var(--er-body); font-size: var(--fs-nav); color: var(--er-petrol); }
  .bt button.ok { font-weight: 700; }
  .bt button:hover { background: rgba(14, 91, 102, 0.08); }
  .dots { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .dots button { width: 14px; height: 14px; border-radius: var(--radius-pill); border: 2px solid var(--fg-3); background: transparent; cursor: pointer; padding: 0; }
  .dots button[data-a='allow'] { background: var(--you); border-color: var(--you); }
  .dots button[data-a='deny'] { background: var(--fg-3); }
  .dots button.on { border-color: var(--tone-text); transform: scale(1.3); }
</style>
