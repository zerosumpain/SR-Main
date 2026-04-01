<svelte:head>
	<title>100-Day Plan — CDO DfE</title>
</svelte:head>

<script lang="ts">
	import type { PageData } from './$types';
	import type { KanbanPlan, KanbanCard, ThemeKey } from '$lib/cdo/types';
	import { THEME_COLORS } from '$lib/cdo/types';

	let { data }: { data: PageData } = $props();

	let running = $state(false);
	let planId = $state<string | null>(null);
	let logs = $state<{ message: string; timestamp: number }[]>([]);
	let phase = $state<string>('idle');
	let error = $state('');
	let selectedCard = $state<KanbanCard | null>(null);
	let filterTheme = $state<string | null>(null);
	let showActivity = $state(true);

	let plan = $derived((data.plan?.structure ?? null) as KanbanPlan | null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
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

	function phaseLabel(status: string): string {
		switch (status) {
			case 'phase1': return 'Lead Generation';
			case 'phase2': return 'Deep Research';
			case 'phase3': return 'Red Teaming';
			case 'post_processing': return 'Post-Processing';
			case 'complete': return 'Complete';
			case 'synthesizing': return 'Synthesizing';
			case 'failed': return 'Failed';
			default: return status;
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
					} else if (d.type === 'stats') {
						// Update activity stats from SSE
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
						// Refresh activity
						const actRes = await fetch('/api/cdo-plan/activity');
						if (actRes.ok) data.activity = await actRes.json();
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

	// Filtered cards by theme
	let filteredCards = $derived(
		plan?.cards?.filter((c: KanbanCard) => !filterTheme || c.theme === filterTheme) ?? []
	);

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

	// Activity data from server
	let runs = $derived(data.activity?.runs ?? []);
	let totalSources = $derived(data.activity?.totalSources ?? 0);
	let totalFacts = $derived(data.activity?.totalFacts ?? 0);
	let totalEntities = $derived(data.activity?.totalEntities ?? 0);
</script>

<div class="min-h-screen" style="background: var(--bg);">
	<!-- Header -->
	<header class="border-b" style="border-color: var(--card-border); background: var(--card-bg);">
		<div class="max-w-[1800px] mx-auto px-6 py-4">
			<div class="flex items-center justify-between">
				<div>
					<a href="/projects" class="text-[11px] uppercase tracking-[0.3em] block mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">&larr; Projects</a>
					<h1 class="text-xl font-bold" style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;">
						First 100 Days
					</h1>
					<p class="text-[11px]" style="color: var(--text-muted); font-family: var(--font-mono);">
						CDO Plan &mdash; Department for Education
						{#if data.plan?.status === 'complete'}
							&middot; {totalCards} actions
							&middot; {runs.length} research {runs.length === 1 ? 'run' : 'runs'}
							&middot; last updated {formatDate(data.plan.updatedAt)}
						{/if}
					</p>
				</div>

				<div class="flex items-center gap-2">
					<button onclick={() => (showActivity = !showActivity)} class="px-3 py-2 rounded-lg text-[11px] uppercase tracking-[0.15em]" style="background: {showActivity ? 'var(--accent)' : 'var(--card-bg)'}; color: {showActivity ? 'white' : 'var(--text-muted)'}; border: 1px solid {showActivity ? 'var(--accent)' : 'var(--card-border)'}; font-family: var(--font-mono);">
						Activity
					</button>
					<button onclick={runResearch} disabled={running} class="px-4 py-2 rounded-lg text-[11px] uppercase tracking-[0.15em] disabled:opacity-50" style="background: var(--accent); color: white; font-family: var(--font-mono);">
						{running ? (phase === 'synthesizing' ? 'Synthesizing...' : 'Researching...') : 'Deepen Research'}
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

	<div class="flex max-w-[1800px] mx-auto">
		<!-- Activity panel (collapsible sidebar) -->
		{#if showActivity}
			<aside class="w-72 shrink-0 border-r px-4 py-4 overflow-y-auto" style="border-color: var(--card-border); max-height: calc(100vh - 140px); position: sticky; top: 140px;">
				<!-- Running progress -->
				{#if running}
					<div class="mb-4">
						<div class="flex items-center gap-2 mb-2">
							<span class="inline-block w-2 h-2 rounded-full animate-pulse" style="background: var(--accent);"></span>
							<p class="text-[10px] uppercase tracking-[0.2em] font-bold" style="color: var(--accent); font-family: var(--font-mono);">
								{phaseLabel(phase)}
							</p>
						</div>
						<div class="space-y-0.5 max-h-40 overflow-y-auto mb-3">
							{#each logs as log}
								<p class="text-[9px] leading-tight" style="color: var(--text-ghost); font-family: var(--font-mono);">{log.message}</p>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Error -->
				{#if error}
					<div class="mb-4 p-2 rounded-lg text-[10px]" style="background: #3b1a1a; color: #fca5a5; font-family: var(--font-mono);">{error}</div>
				{/if}

				<!-- Aggregate stats -->
				<div class="mb-4 p-3 rounded-lg" style="background: var(--card-bg); border: 1px solid var(--card-border);">
					<p class="text-[10px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">Research Base</p>
					<div class="grid grid-cols-2 gap-2">
						<div>
							<p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">{totalSources}</p>
							<p class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Sources</p>
						</div>
						<div>
							<p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">{totalFacts}</p>
							<p class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Facts</p>
						</div>
						<div>
							<p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">{totalEntities}</p>
							<p class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Entities</p>
						</div>
						<div>
							<p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">{runs.length}</p>
							<p class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Runs</p>
						</div>
					</div>
				</div>

				<!-- Research run history -->
				<p class="text-[10px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">Research Runs</p>
				<div class="space-y-1.5">
					{#each runs as run}
						<div class="p-2.5 rounded-lg" style="background: var(--card-bg); border: 1px solid var(--card-border);">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded" style="background: {run.status === 'complete' ? 'rgba(45,125,70,0.12)' : run.status === 'failed' ? '#3b1a1a' : 'var(--bg-section)'}; color: {run.status === 'complete' ? '#2d7d46' : run.status === 'failed' ? '#fca5a5' : 'var(--text-muted)'}; font-family: var(--font-mono);">
									{phaseLabel(run.status)}
								</span>
								<span class="text-[8px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{formatDate(run.createdAt)}</span>
							</div>
							<p class="text-[10px] truncate" style="color: var(--text-primary);">{run.topic}</p>
							<p class="text-[9px] mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">
								{run.factCount} facts &middot; {run.entityCount} entities &middot; {run.sourceCount} sources
							</p>
						</div>
					{/each}
				</div>
			</aside>
		{/if}

		<!-- Main content area -->
		<div class="flex-1 min-w-0">
			<!-- Executive Summary -->
			{#if plan?.summary}
				<div class="px-6 py-4">
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
				<div class="px-6 py-16 text-center">
					<div class="p-12 rounded-xl border" style="background: var(--card-bg); border-color: var(--card-border);">
						<p class="text-sm mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">No plan yet</p>
						<p class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">Click "Deepen Research" to begin gathering intelligence for your 100-day plan.</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
