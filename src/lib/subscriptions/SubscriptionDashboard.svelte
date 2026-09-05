<script lang="ts">
	import type { DashboardData, SubscriptionRecord } from '$lib/subscriptions/reconciliation';

	let { data, onReview, onCancel } = $props<{
		data: DashboardData;
		onReview?: (record: SubscriptionRecord) => void;
		onCancel?: (record: SubscriptionRecord) => void;
	}>();

	const money = (minor: number, currency: string | null) =>
		new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency ?? 'GBP' }).format(minor / 100);
</script>

<section aria-labelledby="subscriptions-heading">
	<h1 id="subscriptions-heading">Subscription reconciliation</h1>
	<p>
		{data.currency
			? `${money(data.activeMonthlyEstimateMinor, data.currency)} estimated each month`
			: 'Monthly estimate is unavailable when active subscriptions use multiple currencies.'}
	</p>

	<h2>Review queue ({data.reviewQueue.length})</h2>
	{#if data.reviewQueue.length === 0}
		<p>No subscriptions need review.</p>
	{:else}
		<ul>
			{#each data.reviewQueue as record (record.id)}
				<li>
					<strong>{record.merchant}</strong>
					{#if record.amountMinor !== null} — {money(record.amountMinor, record.currency)} {record.cadence}{/if}
					 — {record.confidence}% confidence, {record.evidence.length} evidence item{record.evidence.length === 1 ? '' : 's'}
					<button type="button" onclick={() => onReview?.(record)}>Review</button>
					{#if record.evidence.some((item) => item.source === 'paypal' && item.externalSubscriptionId)}
						<button type="button" onclick={() => onCancel?.(record)}>Request PayPal cancellation</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Cancellation queue ({data.cancellationQueue.length})</h2>
	{#if data.cancellationQueue.length === 0}
		<p>No cancellation requests are awaiting resolution.</p>
	{:else}
		<ul>
			{#each data.cancellationQueue as record (record.id)}
				<li><strong>{record.merchant}</strong> — {record.status === 'cancellation_failed' ? record.cancellation?.error : 'Cancellation requested'}</li>
			{/each}
		</ul>
	{/if}
</section>
