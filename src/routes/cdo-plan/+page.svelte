<svelte:head>
	<title>CDO 100-Day Plan — DfE</title>
</svelte:head>

<script lang="ts">
	import type { PageData } from './$types';
	import type { PlanSection, PlanChangelog } from '$lib/cdo/types';

	let { data }: { data: PageData } = $props();

	let running = $state(false);
	let planId = $state<string | null>(null);
	let logs = $state<{ icon: string; message: string; timestamp: number }[]>([]);
	let phase = $state<string>('idle');
	let error = $state('');
	let showHistory = $state(false);
	let viewingPlan = $state<any>(null);
	let showChangelog = $state<string | null>(null);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
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

			// Connect to SSE stream
			const eventSource = new EventSource(`/api/cdo-plan/status?planId=${id}`);

			eventSource.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					if (data.type === 'log') {
						logs = [...logs, { icon: '', message: data.message, timestamp: Date.now() }];
					} else if (data.type === 'status') {
						const status = data.data?.status;
						if (status === 'complete') {
							phase = 'synthesizing';
							logs = [...logs, { icon: '', message: 'Research complete. Synthesizing plan...', timestamp: Date.now() }];
						} else if (status === 'failed') {
							error = 'Research failed';
							running = false;
							eventSource.close();
						} else if (status && status !== 'connected') {
							phase = status;
						}
					} else if (data.type === 'error') {
						error = data.message ?? 'Unknown error';
						eventSource.close();
						running = false;
					}
				} catch {
					// ignore parse errors
				}
			};

			// Poll for plan completion
			const pollInterval = setInterval(async () => {
				try {
					const planRes = await fetch('/api/cdo-plan');
					const plan = await planRes.json();

					if (plan?.status === 'complete') {
						clearInterval(pollInterval);
						eventSource.close();
						data.plan = plan;
						running = false;
						phase = 'complete';
						// Refresh history
						const histRes = await fetch('/api/cdo-plan/history');
						data.history = await histRes.json();
					} else if (plan?.status === 'failed') {
						clearInterval(pollInterval);
						eventSource.close();
						error = 'Plan synthesis failed';
						running = false;
					}
				} catch {
					// ignore poll errors
				}
			}, 5000);
		} catch (e: any) {
			error = e.message ?? 'Network error';
			running = false;
		}
	}

	async function viewVersion(id: string) {
		const res = await fetch(`/api/cdo-plan/${id}`);
		if (res.ok) {
			viewingPlan = await res.json();
		}
	}

	function closeVersionViewer() {
		viewingPlan = null;
	}

	// Get the plan to display — either the current one or a viewed version
	let displayPlan = $derived(viewingPlan ?? data.plan);

	function renderSection(section: PlanSection, depth: number = 0): string {
		const heading = depth === 0 ? 'h2' : depth === 1 ? 'h3' : 'h4';
		const size = depth === 0 ? '1.25rem' : depth === 1 ? '1.1rem' : '1rem';
		const marginTop = depth === 0 ? '2rem' : depth === 1 ? '1.5rem' : '1rem';
		return '';
	}
</script>

<div class="max-w-3xl mx-auto px-6 py-12">
	<!-- Header -->
	<div class="mb-10">
		<a
			href="/projects"
			class="text-[13px] uppercase tracking-[0.3em] mb-4 block"
			style="color: var(--text-muted); font-family: var(--font-mono);"
		>
			&larr; Projects
		</a>
		<h1
			class="text-3xl font-bold mb-2"
			style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;"
		>
			First 100 Days
		</h1>
		<p class="text-sm" style="color: var(--text-muted); font-family: var(--font-mono);">
			CDO Plan — Department for Education
		</p>
	</div>

	<!-- Error banner -->
	{#if error}
		<div
			class="mb-6 p-4 rounded-lg text-sm"
			style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
		>
			{error}
		</div>
	{/if}

	<!-- Action bar -->
	<div class="flex items-center gap-3 mb-8">
		<button
			onclick={runResearch}
			disabled={running}
			class="px-5 py-2.5 rounded-xl text-sm uppercase tracking-[0.2em] transition-colors disabled:opacity-50"
			style="background: var(--accent); color: white; font-family: var(--font-mono);"
		>
			{running ? (phase === 'synthesizing' ? 'Synthesizing...' : 'Researching...') : (data.plan ? 'Refresh Research' : 'Run Research')}
		</button>

		{#if data.history.length > 1}
			<button
				onclick={() => (showHistory = !showHistory)}
				class="px-4 py-2.5 rounded-xl text-sm uppercase tracking-[0.2em]"
				style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
			>
				{showHistory ? 'Hide History' : `History (${data.history.length})`}
			</button>
		{/if}

		{#if data.plan?.status === 'complete' && data.plan.updatedAt}
			<span class="text-[11px] ml-auto" style="color: var(--text-ghost); font-family: var(--font-mono);">
				v{data.plan.version} &middot; {formatDate(data.plan.updatedAt)}
			</span>
		{/if}
	</div>

	<!-- Research progress -->
	{#if running}
		<div
			class="mb-8 p-5 rounded-xl border"
			style="background: var(--card-bg); border-color: var(--card-border);"
		>
			<p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
				{phase === 'synthesizing' ? 'Synthesizing Plan' : 'Research in Progress'}
			</p>
			<div class="space-y-1 max-h-60 overflow-y-auto">
				{#each logs as log}
					<p class="text-xs" style="color: var(--text-muted); font-family: var(--font-mono);">
						{log.message}
					</p>
				{/each}
				{#if logs.length === 0}
					<p class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">
						Starting research engine...
					</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Version viewer overlay -->
	{#if viewingPlan}
		<div class="mb-6">
			<button
				onclick={closeVersionViewer}
				class="text-[13px] uppercase tracking-[0.2em] mb-3"
				style="color: var(--text-muted); font-family: var(--font-mono);"
			>
				&larr; Back to current
			</button>
			<p class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
				Viewing version {viewingPlan.version} &middot; {formatDate(viewingPlan.createdAt)}
			</p>
		</div>
	{/if}

	<!-- History sidebar -->
	{#if showHistory && data.history.length > 1}
		<div
			class="mb-8 p-4 rounded-xl border"
			style="background: var(--card-bg); border-color: var(--card-border);"
		>
			<p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
				Version History
			</p>
			<div class="space-y-2">
				{#each data.history as h}
					<button
						onclick={() => viewVersion(h.id)}
						class="w-full text-left p-3 rounded-lg flex items-center justify-between"
						style="background: var(--bg); border: 1px solid var(--card-border);"
					>
						<span class="text-xs" style="color: var(--text-primary); font-family: var(--font-mono);">
							v{h.version} &mdash; {formatDate(h.createdAt)}
						</span>
						{#if h.changelog}
							<button
								onclick={(e) => { e.stopPropagation(); showChangelog = showChangelog === h.id ? null : h.id; }}
								class="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
								style="color: var(--accent); font-family: var(--font-mono);"
							>
								changes
							</button>
						{/if}
					</button>
					{#if showChangelog === h.id && h.changelog}
						{@const cl = h.changelog as PlanChangelog}
						<div class="ml-4 p-3 rounded-lg text-xs" style="background: var(--bg); font-family: var(--font-mono);">
							{#if cl.reasoning}
								<p class="mb-2" style="color: var(--text-muted);">{cl.reasoning}</p>
							{/if}
							{#if cl.added?.length}
								<p style="color: #2d7d46;">+ Added: {cl.added.join(', ')}</p>
							{/if}
							{#if cl.modified?.length}
								<p style="color: var(--accent);">~ Modified: {cl.modified.join(', ')}</p>
							{/if}
							{#if cl.removed?.length}
								<p style="color: #8b3a1a;">- Removed: {cl.removed.join(', ')}</p>
							{/if}
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<!-- Plan content -->
	{#if displayPlan?.status === 'complete' && displayPlan.structure}
		{@const structure = displayPlan.structure}
		<div class="mb-8">
			{#if structure.summary}
				<div
					class="p-5 rounded-xl border mb-8"
					style="background: var(--card-bg); border-color: var(--card-border);"
				>
					<p class="text-[13px] uppercase tracking-[0.25em] mb-3" style="color: var(--text-muted); font-family: var(--font-mono);">
						Executive Summary
					</p>
					<p class="text-sm leading-relaxed" style="color: var(--text-primary); font-family: var(--font-body); white-space: pre-line;">
						{structure.summary}
					</p>
				</div>
			{/if}

			{#if structure.sections}
				{#each structure.sections as section, i}
					{@render planSection(section, 0)}
				{/each}
			{/if}
		</div>
	{:else if !running}
		<div
			class="p-8 rounded-xl border text-center"
			style="background: var(--card-bg); border-color: var(--card-border);"
		>
			<p class="text-sm mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
				No plan yet
			</p>
			<p class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">
				Click "Run Research" to begin gathering intelligence for your 100-day plan.
			</p>
		</div>
	{/if}
</div>

{#snippet planSection(section: PlanSection, depth: number)}
	<div style="margin-top: {depth === 0 ? '2rem' : depth === 1 ? '1.5rem' : '1rem'};">
		{#if section.type === 'kpi'}
			<div
				class="p-4 rounded-xl border"
				style="background: var(--card-bg); border-color: var(--card-border);"
			>
				<p class="text-[11px] uppercase tracking-[0.2em] mb-1" style="color: var(--text-muted); font-family: var(--font-mono);">
					KPI
				</p>
				<p class="text-sm font-bold" style="color: var(--text-primary);">{section.title}</p>
				{#if section.content}
					<p class="text-xs mt-1" style="color: var(--text-muted);">{section.content}</p>
				{/if}
			</div>
		{:else if section.type === 'milestone'}
			<div
				class="p-4 rounded-xl border-l-4"
				style="background: var(--card-bg); border-left-color: var(--accent);"
			>
				<div class="flex items-center gap-2 mb-1">
					<span class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded" style="background: var(--accent); color: white; font-family: var(--font-mono);">
						Milestone
					</span>
					{#if section.metadata?.deadline}
						<span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
							{section.metadata.deadline}
						</span>
					{/if}
				</div>
				<p class="text-sm font-bold" style="color: var(--text-primary);">{section.title}</p>
				{#if section.content}
					<p class="text-xs mt-1" style="color: var(--text-muted);">{section.content}</p>
				{/if}
			</div>
		{:else if section.type === 'task'}
			<div class="flex items-start gap-2 py-1">
				<span class="mt-1 shrink-0 w-4 h-4 rounded border" style="border-color: var(--card-border);"></span>
				<div class="flex-1">
					<p class="text-sm" style="color: var(--text-primary);">{section.title}</p>
					{#if section.content}
						<p class="text-xs mt-0.5" style="color: var(--text-muted);">{section.content}</p>
					{/if}
					{#if section.metadata}
						<div class="flex gap-2 mt-1">
							{#if section.metadata.priority}
								<span class="text-[10px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded" style="background: var(--card-border); color: var(--text-muted); font-family: var(--font-mono);">
									{section.metadata.priority}
								</span>
							{/if}
							{#if section.metadata.deadline}
								<span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
									{section.metadata.deadline}
								</span>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{:else if section.type === 'note'}
			<div
				class="p-3 rounded-lg text-xs"
				style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-muted); font-family: var(--font-mono);"
			>
				<span style="color: var(--accent);">Note:</span> {section.content ?? section.title}
			</div>
		{:else}
			<!-- section or unknown type -->
			<p
				class="font-bold"
				style="font-size: {depth === 0 ? '1.25rem' : depth === 1 ? '1.1rem' : '1rem'}; color: var(--text-primary); margin-bottom: 0.5rem;"
			>
				{section.title}
			</p>
			{#if section.content}
				<p class="text-sm mb-3" style="color: var(--text-muted);">{section.content}</p>
			{/if}
		{/if}

		{#if section.children?.length}
			<div class="ml-4">
				{#each section.children as child}
					{@render planSection(child, depth + 1)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
