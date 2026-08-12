import { platform } from '$lib/platform';

// --- Types ---
export interface Subscription {
  id: string;
  name: string;
  provider: 'gmail' | 'paypal';
  renewalDate: string; // ISO date string
  amount?: number;
  currency?: string;
  status: 'active' | 'cancelled' | 'expired';
  lastDetectedAt: string; // ISO datetime
}

export interface RenewalReminder {
  subscriptionId: string;
  name: string;
  renewalDate: string;
  daysUntilRenewal: number;
  amount?: number;
  currency?: string;
}

// --- Datastore helpers ---
const COLLECTION = 'subscriptions';

async function getExistingSubscriptions(): Promise<Subscription[]> {
  try {
    const result = await platform.call('datastore_query', { collection: COLLECTION });
    // datastore_query returns { items: any[] }
    if (result && Array.isArray((result as any).items)) {
      return (result as any).items as Subscription[];
    }
    return [];
  } catch {
    return [];
  }
}

async function saveSubscription(sub: Subscription): Promise<void> {
  await platform.call('datastore_save', { collection: COLLECTION, item: sub });
}

async function updateSubscription(id: string, updates: Partial<Subscription>): Promise<void> {
  const existing = await getExistingSubscriptions();
  const sub = existing.find(s => s.id === id);
  if (!sub) throw new Error(`Subscription ${id} not found`);
  await platform.call('datastore_update', { collection: COLLECTION, id, updates });
}

// --- Extraction from Gmail ---
interface GmailInvoice {
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

async function extractFromGmail(): Promise<Omit<Subscription, 'id'>[]> {
  const result = await platform.call('gmail_subscription_invoices', {});
  const invoices: GmailInvoice[] = Array.isArray(result) ? result as GmailInvoice[] : [];
  return invoices.map((inv, idx) => {
    // Parse renewal date from snippet/date — simple heuristic: use message date + 30 days
    const msgDate = new Date(inv.date);
    const renewalDate = new Date(msgDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return {
      name: inv.from || inv.subject || 'Unknown Subscription',
      provider: 'gmail' as const,
      renewalDate,
      status: 'active' as const,
      lastDetectedAt: new Date().toISOString(),
    };
  });
}

// --- Extraction from PayPal ---
interface PayPalSubscription {
  id: string;
  name?: string;
  status?: string;
  next_billing_time?: string;
  amount?: { value?: string; currency_code?: string };
}

async function extractFromPayPal(): Promise<Omit<Subscription, 'id'>[]> {
  const result = await platform.call('paypal_subscriptions_list', {});
  const subs: PayPalSubscription[] = Array.isArray(result) ? result as PayPalSubscription[] : [];
  return subs.map((ps) => ({
    id: ps.id,
    name: ps.name || 'PayPal Subscription',
    provider: 'paypal' as const,
    renewalDate: ps.next_billing_time ? ps.next_billing_time.split('T')[0] : '',
    amount: ps.amount?.value ? parseFloat(ps.amount.value) : undefined,
    currency: ps.amount?.currency_code,
    status: (ps.status === 'ACTIVE' ? 'active' : ps.status === 'CANCELLED' ? 'cancelled' : 'active') as Subscription['status'],
    lastDetectedAt: new Date().toISOString(),
  }));
}

// --- Merge and store ---
function mergeSubscriptions(existing: Subscription[], newSubs: Omit<Subscription, 'id'>[]): Subscription[] {
  const merged: Subscription[] = [...existing];
  for (const ns of newSubs) {
    // For PayPal subs, we have an ID; for Gmail we generate one from name+provider
    const nsId = ns.provider === 'paypal' ? (ns as any).id || `${ns.provider}-${ns.name}` : `${ns.provider}-${ns.name}`;
    const idx = merged.findIndex(s => s.id === nsId);
    if (idx >= 0) {
      // Update renewal date if newer
      if (ns.renewalDate > merged[idx].renewalDate) {
        merged[idx].renewalDate = ns.renewalDate;
      }
      merged[idx].lastDetectedAt = new Date().toISOString();
      merged[idx].status = ns.status;
      if (ns.amount !== undefined) merged[idx].amount = ns.amount;
      if (ns.currency !== undefined) merged[idx].currency = ns.currency;
    } else {
      merged.push({ id: nsId, ...ns });
    }
  }
  return merged;
}

// --- Reminders ---
function getUpcomingRenewals(subscriptions: Subscription[], daysThreshold: number = 7): RenewalReminder[] {
  const now = new Date();
  const reminders: RenewalReminder[] = [];
  for (const sub of subscriptions) {
    if (sub.status !== 'active') continue;
    const renewal = new Date(sub.renewalDate);
    const diffDays = Math.ceil((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= daysThreshold) {
      reminders.push({
        subscriptionId: sub.id,
        name: sub.name,
        renewalDate: sub.renewalDate,
        daysUntilRenewal: diffDays,
        amount: sub.amount,
        currency: sub.currency,
      });
    }
  }
  return reminders;
}

async function scheduleReminders(reminders: RenewalReminder[]): Promise<void> {
  for (const r of reminders) {
    // Schedule notification 1 day before renewal, unless it's today
    const remindDate = r.daysUntilRenewal > 0
      ? new Date(new Date(r.renewalDate).getTime() - 24 * 60 * 60 * 1000)
      : new Date(); // already due, remind now
    // Only schedule if remindDate is in the future
    if (remindDate.getTime() > Date.now()) {
      await platform.call('schedule_reply_at', {
        at: remindDate.toISOString(),
        message: `Renewal reminder: ${r.name} renews on ${r.renewalDate}${r.amount ? ` (${r.currency ?? 'USD'} ${r.amount})` : ''}.`,
      });
    } else {
      // Send immediate notification
      await platform.call('schedule_reply_at', {
        at: new Date(Date.now() + 60 * 1000).toISOString(), // 1 minute from now
        message: `Renewal reminder (immediate): ${r.name} renews on ${r.renewalDate}${r.amount ? ` (${r.currency ?? 'USD'} ${r.amount})` : ''}.`,
      });
    }
  }
}

// --- Main entry point ---
export async function processSubscriptionRenewals(): Promise<{
  subscriptionsFound: number;
  remindersScheduled: number;
  report: string;
}> {
  // 1. Fetch existing
  const existing = await getExistingSubscriptions();

  // 2. Extract new data
  const [gmailSubs, paypalSubs] = await Promise.all([
    extractFromGmail(),
    extractFromPayPal(),
  ]);
  const newSubs = [...gmailSubs, ...paypalSubs];

  // 3. Merge
  const merged = mergeSubscriptions(existing, newSubs);

  // 4. Persist all (save each)
  for (const sub of merged) {
    await saveSubscription(sub);
  }

  // 5. Find upcoming renewals (within 7 days)
  const reminders = getUpcomingRenewals(merged, 7);

  // 6. Schedule notifications
  await scheduleReminders(reminders);

  // 7. Return summary
  return {
    subscriptionsFound: merged.length,
    remindersScheduled: reminders.length,
    report: `Found ${merged.length} subscriptions (${gmailSubs.length} from Gmail, ${paypalSubs.length} from PayPal). Scheduled ${reminders.length} renewal reminders.`,
  };
}
