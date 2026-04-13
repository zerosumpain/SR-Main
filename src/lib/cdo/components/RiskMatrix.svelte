<script lang="ts">
	import type { KanbanCard, ThemeKey } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { cards }: { cards: KanbanCard[] } = $props();

	function themeColor(theme: string) {
		return THEME_COLORS[theme as ThemeKey] ?? THEME_COLORS.governance;
	}

	function impactOf(priority: string): number {
		return ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[priority] ?? 1;
	}

	function likelihoodOf(theme: string): number {
		return ({ risk: 4, compliance: 4, governance: 3, platform: 2, culture: 2 } as Record<string, number>)[theme] ?? 1;
	}

	// Build a 4x4 grid: rows = impact (4 top, 1 bottom), cols = likelihood (1 left, 4 right)
	let grid = $derived(() => {
		const cells: (KanbanCard[])[][] = Array.from({ length: 4 }, () =>
			Array.from({ length: 4 }, () => [])
		);
		for (const card of cards) {
			const impact = impactOf(card.priority) - 1;       // 0-3
			const likelihood = likelihoodOf(card.theme) - 1;  // 0-3
			// Flip impact so row 0 = high impact (top)
			const row = 3 - impact;
			const col = likelihood;
			if (row >= 0 && row < 4 && col >= 0 && col < 4) {
				cells[row][col].push(card);
			}
		}
		return cells;
	});

	function cellBg(row: number, col: number): string {
		// Risk score: higher row (high impact) + higher col (high likelihood) = more red
		const score = (3 - row) + col; // 0-6
		if (score >= 5) return '#3b1a1a';
		if (score >= 3) return '#3b2f1a';
		return '#1a3c34';
	}

	function cellBorder(row: number, col: number): string {
		const score = (3 - row) + col;
		if (score >= 5) return '#ef444444';
		if (score >= 3) return '#f59e0b44';
		return '#10b98144';
	}
</script>

<div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
	<p class="text-[11px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
		Risk Matrix
	</p>
	<div class="flex gap-2">
		<!-- Y-axis label -->
		<div class="flex flex-col justify-between py-2 pr-1" style="writing-mode: vertical-lr; transform: rotate(180deg);">
			<span class="text-[8px] uppercase tracking-[0.1em]" style="color: var(--text-ghost); font-family: var(--font-mono);">High Impact</span>
			<span class="text-[8px] uppercase tracking-[0.1em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Low Impact</span>
		</div>
		<div>
			<!-- X-axis label -->
			<p class="text-[8px] uppercase tracking-[0.1em] text-center mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
				Likelihood: Low &rarr; High
			</p>
			<div class="grid grid-cols-4 gap-1">
				{#each grid() as row, ri}
					{#each row as cell, ci}
						<div class="p-1.5 rounded min-h-[60px]" style="background: {cellBg(ri, ci)}; border: 1px solid {cellBorder(ri, ci)};">
							{#if cell.length > 0}
								{#each cell.slice(0, 3) as card}
									<p class="text-[8px] leading-tight truncate mb-0.5" style="color: var(--text-muted); font-family: var(--font-mono);" title={card.title}>
										{card.title}
									</p>
								{/each}
								{#if cell.length > 3}
									<p class="text-[7px]" style="color: var(--text-ghost); font-family: var(--font-mono);">+{cell.length - 3}</p>
								{/if}
							{/if}
						</div>
					{/each}
				{/each}
			</div>
		</div>
	</div>
</div>
