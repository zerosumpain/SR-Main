import { platform } from '$lib/platform'; // hypothetical platform call wrapper
import { datastore } from '$lib/datastore'; // hypothetical datastore client

/** Result of a single detection run */
export interface DetectionRun {
  runId: string;
  timestamp: Date;
  subscriptions: DetectedSubscription[];
}

export interface DetectedSubscription {
  /** Unique identifier from the source (TL transaction ID or Gmail message ID) */
  sourceId: string;
  /** Name of subscription */
  name: string;
  /** Amount in minor currency units (e.g., pence) */
  amountMinor: number;
  /** Currency code (e.g., 'GBP') */
  currency: string;
  /** Frequency description as raw text */
  frequency: string;
  /** Source of detection: 'truelayer', 'gmail', or 'matched' */
  source: 'truelayer' | 'gmail' | 'matched';
  /** Status: 'active', 'new', 'cancelled' */
  status: 'active' | 'new' | 'cancelled';
  /** First detected date (ISO string) */
  detectedAt: string;
}

/**
 * Fetch TrueLayer transactions via the existing truelayer_accounts tool.
 * Returns a list of transactions with amount, description, date.
 */
async function fetchTrueLayerTransactions(): Promise<any[]> {
  const result = await platform.call('truelayer_accounts', {
    // The tool fetches bank account balances and recent transactions.
    // We'll ask for transactions from the last 60 days to cover multiple billing cycles.
    days: 60
  });
  if (!result || result.error) {
    throw new Error(`TrueLayer fetch failed: ${result?.error || 'no data'}`);
  }
  // Expected shape: { accounts: [...] } with transactions nested
  const accounts: any[] = result.accounts || [];
  const transactions: any[] = [];
  for (const account of accounts) {
    if (account.transactions && Array.isArray(account.transactions)) {
      transactions.push(...account.transactions);
    }
  }
  return transactions;
}

/**
 * Fetch Gmail invoices via the existing gmail_subscription_invoices tool.
 * Returns extracted invoice details.
 */
async function fetchGmailInvoices(): Promise<any[]> {
  const result = await platform.call('gmail_subscription_invoices', {});
  if (!result || result.error) {
    throw new Error(`Gmail invoice fetch failed: ${result?.error || 'no data'}`);
  }
  // Expected shape: { invoices: [...] } or just an array
  const invoices: any[] = result.invoices || result || [];
  return invoices;
}

/**
 * Call the existing subscription_detector tool which cross-references
 * PayPal and Gmail invoices. Then we enhance it with TrueLayer data.
 */
async function callExistingDetector(): Promise<any> {
  const result = await platform.call('subscription_detector', {});
  if (!result || result.error) {
    throw new Error(`Subscription detector failed: ${result?.error || 'no data'}`);
  }
  return result;
}

/**
 * Normalize amount into minor currency units (e.g., pence) for comparison.
 * Assumes amount is a number, or string like '12.99'
 */
function normalizeAmount(amount: any): number | null {
  if (typeof amount === 'number') return Math.round(amount * 100);
  if (typeof amount === 'string') {
    const parsed = parseFloat(amount);
    if (!isNaN(parsed)) return Math.round(parsed * 100);
  }
  return null;
}

/**
 * Infer a frequency label from a recurring pattern description or transaction metadata.
 */
function inferFrequency(description: string, transaction?: any): string {
  const lower = description.toLowerCase();
  if (lower.includes('monthly')) return 'monthly';
  if (lower.includes('weekly')) return 'weekly';
  if (lower.includes('yearly') || lower.includes('annual')) return 'yearly';
  if (lower.includes('quarter')) return 'quarterly';
  if (lower.includes('bi-week') || lower.includes('fortnight')) return 'bi-weekly';
  // If from TrueLayer, check if transaction metadata has frequency
  if (transaction?.frequency) return transaction.frequency;
  return 'unknown';
}

/**
 * Main pipeline: fetch all data, match, and return detected subscriptions.
 * This function should be called on a schedule.
 */
export async function runSubscriptionDetection(): Promise<DetectionRun> {
  const runId = crypto.randomUUID();
  const timestamp = new Date();

  // Fetch all sources
  const [tlTransactions, gmailInvoices, existingDetectorResult] = await Promise.all([
    fetchTrueLayerTransactions().catch(err => {
      console.error('TrueLayer fetch failed:', err);
      return [] as any[];
    }),
    fetchGmailInvoices().catch(err => {
      console.error('Gmail invoice fetch failed:', err);
      return [] as any[];
    }),
    callExistingDetector().catch(err => {
      console.error('Existing detector failed:', err);
      return { subscriptions: [] };
    })
  ]);

  // Build a map of known subscriptions from the existing detector to carry forward status
  const knownSubscriptions: Map<string, DetectedSubscription> = new Map();
  const existingSubs = existingDetectorResult.subscriptions || [];
  for (const sub of existingSubs) {
    if (sub.name) {
      knownSubscriptions.set(sub.name.toLowerCase(), {
        sourceId: sub.sourceId || '',
        name: sub.name,
        amountMinor: normalizeAmount(sub.amount) ?? 0,
        currency: sub.currency || 'GBP',
        frequency: sub.frequency || '',
        source: 'matched',
        status: 'active',
        detectedAt: sub.detectedAt || timestamp.toISOString()
      });
    }
  }

  // Process TrueLayer transactions into potential subscriptions
  const detectedSubscriptionsMap: Map<string, DetectedSubscription> = new Map();

  for (const tx of tlTransactions) {
    const amountMinor = normalizeAmount(tx.amount);
    if (amountMinor === null || amountMinor <= 0) continue;
    // Skip very small transactions that are unlikely to be subscriptions
    if (amountMinor < 100) continue; // < £1.00
    const description = tx.description || tx.merchant_name || tx.counterparty || 'Unknown';
    const key = `${description.toLowerCase()}-${amountMinor}`;
    if (!detectedSubscriptionsMap.has(key)) {
      detectedSubscriptionsMap.set(key, {
        sourceId: tx.transaction_id || tx.id || `tl-${Date.now()}-${Math.random()}`,
        name: description,
        amountMinor,
        currency: tx.currency || 'GBP',
        frequency: inferFrequency(description, tx),
        source: 'truelayer',
        status: 'active',
        detectedAt: tx.timestamp || tx.date || timestamp.toISOString()
      });
    }
  }

  // Process Gmail invoices into potential subscriptions
  for (const inv of gmailInvoices) {
    const amountMinor = normalizeAmount(inv.amount);
    if (amountMinor === null || amountMinor <= 0) continue;
    if (amountMinor < 100) continue;
    const sender = inv.sender || inv.from || 'Unknown';
    const subject = inv.subject || 'No subject';
    // Use amount + sender as key for matching
    const key = `${sender.toLowerCase()}-${amountMinor}`;
    if (!detectedSubscriptionsMap.has(key)) {
      detectedSubscriptionsMap.set(key, {
        sourceId: inv.messageId || `gm-${Date.now()}-${Math.random()}`,
        name: subject,
        amountMinor,
        currency: inv.currency || 'GBP',
        frequency: inferFrequency(subject + ' ' + (inv.snippet || '')),
        source: 'gmail',
        status: 'active',
        detectedAt: inv.date || timestamp.toISOString()
      });
    }
  }

  // Merge with known subscriptions: mark new ones, keep existing active, detect cancellations
  const finalSubscriptions: DetectedSubscription[] = [];

  // First, add all known subscriptions. Check if they still appear in the detected list.
  const seenKeys = new Set<string>();
  for (const [key, sub] of knownSubscriptions) {
    const detectedKey = `${sub.name.toLowerCase()}-${sub.amountMinor}`;
    if (detectedSubscriptionsMap.has(detectedKey)) {
      // Still active
      finalSubscriptions.push({ ...sub, status: 'active', source: 'matched' });
      seenKeys.add(detectedKey);
    } else {
      // Not detected this time => mark as cancelled
      finalSubscriptions.push({ ...sub, status: 'cancelled' });
    }
  }

  // Add any new subscriptions that were not previously known
  for (const [key, sub] of detectedSubscriptionsMap) {
    if (!seenKeys.has(key)) {
      finalSubscriptions.push({ ...sub, status: 'new' });
    }
  }

  // Persist detection run to datastore for history
  const run: DetectionRun = {
    runId,
    timestamp,
    subscriptions: finalSubscriptions
  };

  await datastore.save('subscription_detection_runs', runId, run).catch(err => {
    console.error('Failed to persist detection run:', err);
  });

  return run;
}
