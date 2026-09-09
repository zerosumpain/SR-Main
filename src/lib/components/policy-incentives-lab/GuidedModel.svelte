<script lang="ts">
  let { save, busy }: { save: (outline: unknown) => void; busy: boolean } = $props();
  let intended = $state(''); let mechanism = $state(''); let metric = $state(''); let unit = $state('');
  let people = $state([{ name: '', wants: '', first: '', second: '' }, { name: '', wants: '', first: '', second: '' }]);
</script>
<details><summary>Build a small starting model in everyday words</summary>
<p>Start with two groups and two choices each. This is a simplification to review, not a complete description of the policy. Everything you enter is labelled as your assumption until you link it to evidence.</p>
<form onsubmit={e => { e.preventDefault(); save({ intended, mechanism, metric, unit, people }); }}>
<label>What should the policy achieve?<textarea required maxlength="1000" bind:value={intended} placeholder="For example: repairs that last longer"></textarea></label>
<label>What rule or reward is supposed to help?<textarea required maxlength="1000" bind:value={mechanism} placeholder="For example: pay after a repair passes a check"></textarea></label>
{#each people as person, i}<fieldset><legend>Group {i + 1}</legend>
<label>Who can make a choice?<input required maxlength="1000" bind:value={person.name} /></label><label>What do they want?<input required maxlength="1000" bind:value={person.wants} /></label>
<label>One thing they could do<input required maxlength="1000" bind:value={person.first} /></label><label>A different thing they could do<input required maxlength="1000" bind:value={person.second} /></label>
</fieldset>{/each}
<label>What outcome would you measure?<input required maxlength="1000" bind:value={metric} placeholder="For example: repair reliability" /></label><label>What unit would you use?<input required maxlength="1000" bind:value={unit} placeholder="For example: percent passing an inspection" /></label>
<p>The starter proposes “more is better” for this measure and a simple “choose the highest value” rule for each artificial group. Review and change these before approving anything. All numerical values start unknown.</p>
<button disabled={busy}>Create unapproved outline</button>
</form></details>
<style>fieldset { margin: 16px 0; padding: 12px; border: 1px solid var(--line); } input, textarea { width: 100%; } p { line-height: 1.6; }</style>
