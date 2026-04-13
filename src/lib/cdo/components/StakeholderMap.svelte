<script lang="ts">
	import type { KanbanCard, ThemeKey } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { cards, columns }: {
		cards: KanbanCard[];
		columns: { week: number; label: string; focus: string }[];
	} = $props();

	function themeColor(theme: string) {
		return THEME_COLORS[theme as ThemeKey] ?? THEME_COLORS.governance;
	}

	let stakeholders = $derived(() => {
		const map = new Map<string, { weeks: Set<number>; themes: string[] }>();
		for (const card of cards) {
			for (const s of card.stakeholders ?? []) {
				const key = s.trim();
				if (!key) continue;
				if (!map.has(key)) map.set(key, { weeks: new Set(), themes: [] });
				const entry = map.get(key)!;
				entry.weeks.add(card.week);
				if (!entry.themes.includes(card.theme)) entry.themes.push(card.theme);
			}
		}
		return Array.from(map.entries())
			.map(([name, data]) => ({
				name,
				weeks: Array.from(data.weeks).sort(),
				themes: data.themes
			}))
			.sort((a, b) => b.weeks.length - a.weeks.length);
	});

	let totalWeeks = $derived(Math.max(...columns.map(c => c.week), 14));
</script>

<div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
	<p class="text-[11px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
		Stakeholder Map
	</p>
	{#if stakeholders().length === 0}
		<p class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">No stakeholder data yet</p>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
			{#each stakeholders() as s}
				<div class="p-2.5 rounded-lg border" style="background: var(--bg); border-color: var(--card-border);">
					<p class="text-[11px] font-medium mb-1.5" style="color: var(--text-primary);">{s.name}</p>
					<div class="flex gap-1 mb-2 flex-wrap">
						{#each s.themes as theme}
							{@const tc = themeColor(theme)}
							<span class="text-[8px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
								  style="background: {tc.bg}; color: {tc.text}; font-family: var(--font-mono);">
								{theme}
							</span>
						{/each}
					</div>
					<div class="flex gap-0.5">
						{#each Array.from({ length: totalWeeks }, (_, i) => i + 1) as w}
							<div class="flex-1 h-2 rounded-sm"
								 style="background: {s.weeks.includes(w) ? themeColor(s.themes[0] ?? 'governance').border + '88' : 'var(--card-border)'};"
								 title="Week {w}">
							</div>
						{/each}
					</div>
					<p class="text-[8px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
						{s.weeks.length} week{s.weeks.length !== 1 ? 's' : ''}
					</p>
				</div>
			{/each}
		</div>
	{/if}
</div>
