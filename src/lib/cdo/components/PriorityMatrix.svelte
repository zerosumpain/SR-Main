<script lang="ts">
	import type { KanbanCard, ThemeKey } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { cards }: { cards: KanbanCard[] } = $props();

	function themeColor(theme: string) {
		return THEME_COLORS[theme as ThemeKey] ?? THEME_COLORS.governance;
	}

	const quadrants = [
		{ key: 'critical', label: 'Do First', bg: '#3b1a1a', border: '#ef4444', text: '#fca5a5' },
		{ key: 'high', label: 'Schedule', bg: '#3b2f1a', border: '#f59e0b', text: '#fcd34d' },
		{ key: 'medium', label: 'Delegate', bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
		{ key: 'low', label: 'Eliminate', bg: '#374151', border: '#6b7280', text: '#9ca3af' }
	];

	let quadrantCards = $derived(() => {
		const result: Record<string, KanbanCard[]> = { critical: [], high: [], medium: [], low: [] };
		for (const card of cards) {
			const q = result[card.priority] ?? result.low;
			q.push(card);
		}
		return result;
	});
</script>

<div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
	<p class="text-[11px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
		Priority Matrix
	</p>
	<div class="grid grid-cols-2 gap-2">
		{#each quadrants as q}
			{@const qc = quadrantCards()[q.key]}
			<div class="p-3 rounded-lg border" style="background: {q.bg}; border-color: {q.border}33;">
				<div class="flex items-center justify-between mb-2">
					<p class="text-[10px] uppercase tracking-[0.15em] font-bold" style="color: {q.text}; font-family: var(--font-mono);">
						{q.label}
					</p>
					<span class="text-[9px] px-1.5 py-0.5 rounded" style="background: {q.border}33; color: {q.text}; font-family: var(--font-mono);">
						{qc.length}
					</span>
				</div>
				<div class="space-y-1 max-h-40 overflow-y-auto">
					{#each qc.slice(0, 8) as card}
						{@const tc = themeColor(card.theme)}
						<div class="flex items-center gap-1.5">
							<div class="w-1 h-1 rounded-full shrink-0" style="background: {tc.border};"></div>
							<p class="text-[9px] truncate" style="color: {q.text}; font-family: var(--font-mono);">{card.title}</p>
						</div>
					{/each}
					{#if qc.length > 8}
						<p class="text-[8px]" style="color: {q.text}88; font-family: var(--font-mono);">+{qc.length - 8} more</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>
