<script lang="ts">
	import { onMount } from 'svelte';

	let online = $state(true);

	onMount(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);
		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});
</script>

{#if !online}
	<div class="jkai-offline-banner" role="status">
		Offline — new messages will send when you reconnect.
	</div>
{/if}

<style>
	.jkai-offline-banner {
		width: 100%;
		padding: 0.5rem 1rem;
		background: var(--nm-bg-muted, #f4ede4);
		color: var(--nm-text, #0a0a0a);
		border-bottom: 1px solid var(--nm-border, #d6cfc4);
		font: 0.85rem/1.3 'JetBrains Mono', monospace;
		text-align: center;
	}
</style>
