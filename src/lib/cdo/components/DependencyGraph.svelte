<script lang="ts">
	import type { KanbanCard, ThemeKey } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { cards }: { cards: KanbanCard[] } = $props();

	function themeColor(theme: string) {
		return THEME_COLORS[theme as ThemeKey] ?? THEME_COLORS.governance;
	}

	let cardMap = $derived(new Map(cards.map(c => [c.id, c])));

	let depCards = $derived(
		cards.filter(c => c.dependencies && c.dependencies.length > 0)
	);
</script>

<div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
	<p class="text-[11px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
		Dependency Graph
	</p>
	{#if depCards.length === 0}
		<p class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">No dependencies mapped</p>
	{:else}
		<div class="space-y-2 max-h-80 overflow-y-auto">
			{#each depCards as card}
				{@const tc = themeColor(card.theme)}
				<div class="flex items-start gap-2 text-[9px]">
					<span class="shrink-0 px-1.5 py-0.5 rounded"
						  style="background: {tc.bg}; color: {tc.text}; font-family: var(--font-mono);">
						W{card.week}
					</span>
					<div class="flex-1 min-w-0">
						<p class="truncate mb-1" style="color: var(--text-primary);">{card.title}</p>
						<div class="flex items-center gap-1 flex-wrap">
							<span style="color: var(--text-ghost); font-family: var(--font-mono);">&darr;</span>
							{#each card.dependencies ?? [] as depId}
								{@const dep = cardMap.get(depId)}
								{#if dep}
									{@const dtc = themeColor(dep.theme)}
									<span class="px-1.5 py-0.5 rounded"
										  style="background: {dtc.bg}; color: {dtc.text}; font-family: var(--font-mono);">
										{dep.title}
									</span>
								{:else}
									<span class="px-1.5 py-0.5 rounded"
										  style="background: var(--bg); color: var(--text-ghost); font-family: var(--font-mono);">
										{depId}
									</span>
								{/if}
							{/each}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
