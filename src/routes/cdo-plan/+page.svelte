<svelte:head>
	<title>100-Day Plan — CDO DfE</title>
</svelte:head>

<script lang="ts">
	import type { PageData } from './$types';
	import type { KanbanPlan, KanbanCard, ThemeKey, PlanChangelog } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { data }: { data: PageData } = $props();

	let running = $state(false);
	let planId = $state<string | null>(null);
	let logs = $state<{ message: string; timestamp: number }[]>([]);
	let phase = $state<string>('idle');
	let error = $state('');
	let selectedCard = $state<KanbanCard | null>(null);
	let filterTheme = $state<string | null>(null);
	let showHistory = $state(false);
	let viewingPlan = $state<any>(null);
	let showChangelog = $state<string | null>(null);

	let plan = $derived(viewingPlan?.structure ?? data.plan?.structure as KanbanPlan | null);
	let isViewingOld = $derived(viewingPlan !== null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function themeColor(theme: string) {
		return THEME_COLORS[theme as ThemeKey] ?? THEME_COLORS.governance;
	}

	function priorityBadge(priority: string): { bg: string; text: string } {
		switch (priority) {
			case 'critical': return { bg: '#7f1d1d', text: '#fca5a5' };
			case 'high': return { bg: '#78350f', text: '#fcd34d' };
			case 'medium': return { bg: '#1e3a5f', text: '#93c5fd' };
			default: return { bg: '#374151', text: '#9ca3af' };
		}
	}

	async function runResearch() {
		running = true;
		logs = [];
		phase = 'researching';
		error = '';

		try {
			const res = await fetch('/api/cdo-plan/run', { method: 'POST' });
			if (!res.ok) {
				const body = await res.json();
				error = body.error ?? 'Failed to start research';
				running = false;
				return;
			}

			const { planId: id } = await res.json();
			planId = id;

			const eventSource = new EventSource(`/api/cdo-plan/status?planId=${id}`);

			eventSource.onmessage = (event) => {
				try {
					const d = JSON.parse(event.data);
					if (d.type === 'log') {
						logs = [...logs, { message: d.message, timestamp: Date.now() }];
					} else if (d.type === 'status') {
						const status = d.data?.status;
						if (status === 'complete') {
							phase = 'synthesizing';
							logs = [...logs, { message: 'Research complete. Synthesizing plan...', timestamp: Date.now() }];
						} else if (status === 'failed') {
							error = 'Research failed';
							running = false;
							eventSource.close();
						} else if (status && status !== 'connected') {
							phase = status;
						}
					} else if (d.type === 'error') {
						error = d.message ?? 'Unknown error';
						eventSource.close();
						running = false;
					}
				} catch { /* ignore */ }
			};

			const pollInterval = setInterval(async () => {
				try {
					const planRes = await fetch('/api/cdo-plan');
					const p = await planRes.json();
					if (p?.status === 'complete') {
						clearInterval(pollInterval);
						eventSource.close();
						data.plan = p;
						running = false;
						phase = 'complete';
						const histRes = await fetch('/api/cdo-plan/history');
						data.history = await histRes.json();
					} else if (p?.status === 'failed') {
						clearInterval(pollInterval);
						eventSource.close();
						error = 'Plan synthesis failed';
						running = false;
					}
				} catch { /* ignore */ }
			}, 5000);
		} catch (e: any) {
			error = e.message ?? 'Network error';
			running = false;
		}
	}

	async function viewVersion(id: string) {
		const res = await fetch(`/api/cdo-plan/${id}`);
		if (res.ok) viewingPlan = await res.json();
	}

	// Filtered cards by theme
	let filteredCards = $derived(
		plan?.cards?.filter((c: KanbanCard) => !filterTheme || c.theme === filterTheme) ?? []
	);

	// Group cards by week
	let cardsByWeek = $derived(() => {
		const weeks: Record<number, KanbanCard[]> = {};
		for (const card of filteredCards) {
			if (!weeks[card.week]) weeks[card.week] = [];
			weeks[card.week].push(card);
		}
		return weeks;
	});

	function getCardsForWeek(week: number): KanbanCard[] {
		return filteredCards.filter((c: KanbanCard) => c.week === week);
	}

	let totalCards = $derived(plan?.cards?.length ?? 0);
	let themeCounts = $derived(() => {
		const counts: Record<string, number> = {};
		for (const card of plan?.cards ?? []) {
			counts[card.theme] = (counts[card.theme] ?? 0) + 1;
		}
		return counts;
	});
</script>

<div class="min-h-screen" style="background: var(--bg);">
	<!-- Header -->
	<header class="border-b" style="border-color: var(--card-border); background: var(--card-bg);">
		<div class="max-w-[1800px] mx-auto px-6 py-4">
			<div class="flex items-center justify-between">
				<div>
					<a href="/projects" class="text-[11px] uppercase tracking-[0.3em] block mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">&larr; Projects</a>
					<h1 class="text-xl font-bold" style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;">
						{isViewingOld ? `v${viewingPlan.version} — Historical` : 'First 100 Days'}
					</h1>
					<p class="text-[11px]" style="color: var(--text-muted); font-family: var(--font-mono);">
						CDO Plan — Department for Education
						{#if data.plan?.status === 'complete'}
							&middot; v{data.plan.version} &middot; {totalCards} actions
							&middot; {formatDate(data.plan.updatedAt)}
						{/if}
					</p>
				</div>

				<div class="flex items-center gap-2">
					{#if isViewingOld}
						<button onclick={() => (viewingPlan = null)} class="px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.15em]" style="background: var(--accent); color: white; font-family: var(--font-mono);">
							Back to Current
						</button>
					{/if}
					{#if data.history?.length > 1}
						<button onclick={() => (showHistory = !showHistory)} class="px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.15em]" style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);">
							History ({data.history.length})
						</button>
					{/if}
					<button onclick={runResearch} disabled={running} class="px-4 py-2 rounded-lg text-[11px] uppercase tracking-[0.15em] disabled:opacity-50" style="background: var(--accent); color: white; font-family: var(--font-mono);">
						{running ? (phase === 'synthesizing' ? 'Synthesizing...' : 'Researching...') : (plan ? 'Refresh' : 'Run Research')}
					</button>
				</div>
			</div>

			<!-- Theme filter bar -->
			{#if plan?.themes}
				<div class="flex gap-1.5 mt-3 overflow-x-auto pb-1">
					<button onclick={() => (filterTheme = null)} class="shrink-0 px-3 py-1 rounded text-[10px] uppercase tracking-[0.15em] transition-all" style="font-family: var(--font-mono); background: {filterTheme === null ? 'var(--accent)' : 'var(--bg)'}; color: {filterTheme === null ? 'white' : 'var(--text-muted)'}; border: 1px solid {filterTheme === null ? 'var(--accent)' : 'var(--card-border)'};">
						All ({totalCards})
					</button>
					{#each plan.themes as theme}
						{@const tc = themeColor(theme.key)}
						{@const count = themeCounts()[theme.key] ?? 0}
						<button onclick={() => (filterTheme = filterTheme === theme.key ? null : theme.key)} class="shrink-0 px-3 py-1 rounded text-[10px] uppercase tracking-[0.15em] transition-all" style="font-family: var(--font-mono); background: {filterTheme === theme.key ? tc.border : tc.bg}; color: {filterTheme === theme.key ? 'white' : tc.text}; border: 1px solid {filterTheme === theme.key ? tc.border : 'transparent'};">
							{theme.label} ({count})
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</header>

	<!-- Research progress -->
	{#if running}
		<div class="max-w-[1800px] mx-auto px-6 py-4">
			<div class="p-4 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
				<p class="text-[11px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
					{phase === 'synthesizing' ? 'Synthesizing Plan...' : 'Research in Progress'}
				</p>
				<div class="space-y-0.5 max-h-32 overflow-y-auto">
					{#each logs as log}
						<p class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{log.message}</p>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Error -->
	{#if error}
		<div class="max-w-[1800px] mx-auto px-6 py-2">
			<div class="p-3 rounded-lg text-[11px]" style="background: #3b1a1a; color: #fca5a5; font-family: var(--font-mono);">{error}</div>
		</div>
	{/if}

	<!-- History panel -->
	{#if showHistory && data.history?.length > 1}
		<div class="max-w-[1800px] mx-auto px-6 py-2">
			<div class="p-3 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
				<div class="flex gap-2 flex-wrap">
					{#each data.history as h}
						<button onclick={() => viewVersion(h.id)} class="px-3 py-1.5 rounded-lg text-[10px]" style="background: var(--bg); border: 1px solid var(--card-border); font-family: var(--font-mono); color: var(--text-primary);">
							v{h.version} &mdash; {formatDate(h.createdAt)}
						</button>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Executive Summary -->
	{#if plan?.summary}
		<div class="max-w-[1800px] mx-auto px-6 py-4">
			<div class="p-5 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
				<p class="text-[11px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">Executive Summary</p>
				<p class="text-sm leading-relaxed" style="color: var(--text-secondary); white-space: pre-line;">{plan.summary}</p>
			</div>
		</div>
	{/if}

	<!-- Kanban Board -->
	{#if plan?.columns}
		<div class="overflow-x-auto pb-8">
			<div class="flex gap-3 px-6 min-w-max">
				{#each plan.columns as col}
					<div class="w-72 shrink-0">
						<!-- Column header -->
						<div class="mb-2 px-1">
							<p class="text-[11px] font-bold uppercase tracking-[0.15em]" style="font-family: var(--font-mono); color: var(--text-primary);">
								{col.label}
							</p>
							<p class="text-[10px] mt-0.5" style="color: var(--text-muted); font-family: var(--font-mono);">
								{col.focus}
							</p>
						</div>

						<!-- Cards -->
						<div class="space-y-2 min-h-[200px]">
							{#each getCardsForWeek(col.week) as card (card.id)}
								{@const tc = themeColor(card.theme)}
								{@const pb = priorityBadge(card.priority)}
								<button
									onclick={() => (selectedCard = selectedCard?.id === card.id ? null : card)}
									class="w-full text-left p-3 rounded-lg border-l-[3px] transition-all"
									style="background: var(--card-bg); border-left-color: {tc.border}; border-top: 1px solid var(--card-border); border-right: 1px solid var(--card-border); border-bottom: 1px solid var(--card-border); {selectedCard?.id === card.id ? 'box-shadow: 0 0 0 1px var(--accent);' : ''}"
								>
									<div class="flex items-start justify-between gap-2 mb-1">
										<p class="text-[12px] font-medium leading-tight" style="color: var(--text-primary);">{card.title}</p>
									</div>
									<div class="flex items-center gap-1.5 flex-wrap">
										<span class="text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded" style="background: {tc.bg}; color: {tc.text}; font-family: var(--font-mono);">
											{plan.themes.find((t: any) => t.key === card.theme)?.label ?? card.theme}
										</span>
										<span class="text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded" style="background: {pb.bg}; color: {pb.text}; font-family: var(--font-mono);">
											{card.priority}
										</span>
									</div>
									{#if card.description && selectedCard?.id === card.id}
										<p class="text-[11px] mt-2 leading-relaxed" style="color: var(--text-muted);">{card.description}</p>
										{#if card.stakeholders?.length}
											<div class="mt-2">
												<p class="text-[9px] uppercase tracking-[0.15em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Stakeholders</p>
												<div class="flex gap-1 flex-wrap">
													{#each card.stakeholders as s}
														<span class="text-[9px] px-1.5 py-0.5 rounded" style="background: var(--bg); font-family: var(--font-mono); color: var(--text-muted);">{s}</span>
													{/each}
												</div>
											</div>
										{/if}
										{#if card.outcomes?.length}
											<div class="mt-2">
												<p class="text-[9px] uppercase tracking-[0.15em] mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">Outcomes</p>
												{#each card.outcomes as o}
													<p class="text-[10px]" style="color: var(--text-muted);">&bull; {o}</p>
												{/each}
											</div>
										{/if}
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else if !running}
		<div class="max-w-[1800px] mx-auto px-6 py-16 text-center">
			<div class="p-12 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
				<p class="text-sm mb-2" style="color: var(--text-muted); font-family: var(--font-mono;">No plan yet</p>
				<p class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">Click "Run Research" to begin gathering intelligence for your 100-day plan.</p>
			</div>
		</div>
	{/if}
</div>
