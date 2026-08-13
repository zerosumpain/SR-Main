// Pure module for financial cross-reference consolidation.
// Combines Gmail subscription invoices, PayPal transactions/subscriptions,
// and TrueLayer bank transactions to flag new subscriptions and analyze monthly spend.

// --- Types (mirroring the shapes returned by the finance tools) ---

export interface GmailInvoice {
  id?: string;
  sender?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
}

export interface PayPalTransaction {
  id?: string;
  type?: string;
  status?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  description?: string;
  date?: string;
}

export interface PayPalSubscription {
  id?: string;
  name?: string;
  status?: string;
  amount?: number;
  currency?: string;
  next_billing_date?: string;
}

export interface TrueLayerTransaction {
  transaction_id?: string;
  amount?: number;
  currency?: string;
  description?: string;
  merchant_name?: string;
  timestamp?: string;
}

export interface TrueLayerAccount {
  account_id?: string;
  account_name?: string;
  balance?: number;
  currency?: string;
  transactions?: TrueLayerTransaction[];
}

export interface FinanceInput {
  gmailInvoices?: GmailInvoice[];
  paypalTransactions?: PayPalTransaction[];
  paypalSubscriptions?: PayPalSubscription[];
  truelayerAccounts?: TrueLayerAccount[];
}

export interface SubscriptionMatch {
  name: string;
  source: 'gmail' | 'paypal' | 'truelayer';
  amount?: number;
  currency?: string;
  frequency?: string;
  lastDate?: string;
  merchant?: string;
  id?: string;
}

export interface FlaggedSubscription {
  name: string;
  gmailEvidence: GmailInvoice[];
  paypalEvidence: PayPalTransaction[];
  truelayerEvidence: TrueLayerTransaction[];
  reason: string;
}

export interface MonthlySpend {
  month: string; // YYYY-MM
  total: number;
  currency: string;
  byCategory: Record<string, number>;
  topSubscriptions: { name: string; amount: number }[];
}

export interface ConsolidationResult {
  subscriptions: SubscriptionMatch[];
  flaggedNewSubscriptions: FlaggedSubscription[];
  monthlySpend: MonthlySpend[];
  summary: {
    totalSubscriptions: number;
    flaggedCount: number;
    totalMonthlySpend: number;
    currency: string;
  };
}

// --- Normalization helpers ---

function normalizeName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function extractMerchantFromSubject(subject: string | undefined): string {
  if (!subject) return '';
  // Common patterns: "Your receipt from Acme", "Invoice from Acme", "Acme subscription"
  const match = subject.match(/from\s+([A-Za-z0-9 .&'-]+)/i);
  if (match) return match[1].trim();
  const match2 = subject.match(/invoice\s+from\s+([A-Za-z0-9 .&'-]+)/i);
  if (match2) return match2[1].trim();
  return subject.trim();
}

function extractMerchantFromDescription(description: string | undefined): string {
  if (!description) return '';
  // PayPal descriptions often start with merchant name
  const parts = description.split(/\s*[-–—]\s*/);
  return parts[0]?.trim() ?? description.trim();
}

function extractMerchantFromTrueLayer(description: string | undefined, merchantName: string | undefined): string {
  if (merchantName) return merchantName;
  if (!description) return '';
  // TrueLayer descriptions often include merchant name at start
  const parts = description.split(/\s*[-–—]\s*/);
  return parts[0]?.trim() ?? description.trim();
}

function parseAmount(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function monthKey(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 7);
}

// --- Core matching logic ---

function buildGmailSubscriptions(invoices: GmailInvoice[]): SubscriptionMatch[] {
  const map = new Map<string, SubscriptionMatch>();
  for (const inv of invoices) {
    const merchant = inv.merchant || extractMerchantFromSubject(inv.subject);
    const key = normalizeName(merchant);
    if (!key) continue;
    const existing = map.get(key);
    const amount = parseAmount(inv.amount);
    const date = parseDate(inv.date);
    if (existing) {
      if (amount && !existing.amount) existing.amount = amount;
      if (inv.currency && !existing.currency) existing.currency = inv.currency;
      if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
    } else {
      map.set(key, {
        name: merchant,
        source: 'gmail',
        amount,
        currency: inv.currency,
        lastDate: date,
        merchant,
        id: inv.id,
      });
    }
  }
  return Array.from(map.values());
}

function buildPayPalSubscriptions(transactions: PayPalTransaction[], subscriptions: PayPalSubscription[]): SubscriptionMatch[] {
  const map = new Map<string, SubscriptionMatch>();
  // From transactions
  for (const tx of transactions) {
    const merchant = tx.merchant || extractMerchantFromDescription(tx.description);
    const key = normalizeName(merchant);
    if (!key) continue;
    const amount = parseAmount(tx.amount);
    const date = parseDate(tx.date);
    const existing = map.get(key);
    if (existing) {
      if (amount && !existing.amount) existing.amount = amount;
      if (tx.currency && !existing.currency) existing.currency = tx.currency;
      if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
    } else {
      map.set(key, {
        name: merchant,
        source: 'paypal',
        amount,
        currency: tx.currency,
        lastDate: date,
        merchant,
        id: tx.id,
      });
    }
  }
  // From subscriptions list
  for (const sub of subscriptions) {
    const key = normalizeName(sub.name);
    if (!key) continue;
    const amount = parseAmount(sub.amount);
    const date = parseDate(sub.next_billing_date);
    const existing = map.get(key);
    if (existing) {
      if (amount && !existing.amount) existing.amount = amount;
      if (sub.currency && !existing.currency) existing.currency = sub.currency;
      if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
    } else {
      map.set(key, {
        name: sub.name || '',
        source: 'paypal',
        amount,
        currency: sub.currency,
        lastDate: date,
        merchant: sub.name,
        id: sub.id,
      });
    }
  }
  return Array.from(map.values());
}

function buildTrueLayerSubscriptions(accounts: TrueLayerAccount[]): SubscriptionMatch[] {
  const map = new Map<string, SubscriptionMatch>();
  for (const account of accounts) {
    for (const tx of account.transactions ?? []) {
      const merchant = extractMerchantFromTrueLayer(tx.description, tx.merchant_name);
      const key = normalizeName(merchant);
      if (!key) continue;
      const amount = parseAmount(tx.amount);
      const date = parseDate(tx.timestamp);
      const existing = map.get(key);
      if (existing) {
        if (amount && !existing.amount) existing.amount = amount;
        if (tx.currency && !existing.currency) existing.currency = tx.currency;
        if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date;
      } else {
        map.set(key, {
          name: merchant,
          source: 'truelayer',
          amount,
          currency: tx.currency,
          lastDate: date,
          merchant,
          id: tx.transaction_id,
        });
      }
    }
  }
  return Array.from(map.values());
}

function mergeSubscriptions(gmail: SubscriptionMatch[], paypal: SubscriptionMatch[], truelayer: SubscriptionMatch[]): SubscriptionMatch[] {
  const map = new Map<string, SubscriptionMatch>();
  const add = (sub: SubscriptionMatch) => {
    const key = normalizeName(sub.name);
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      // Merge: prefer non-empty fields, keep earliest source, latest date
      if (!existing.amount && sub.amount) existing.amount = sub.amount;
      if (!existing.currency && sub.currency) existing.currency = sub.currency;
      if (sub.lastDate && (!existing.lastDate || sub.lastDate > existing.lastDate)) existing.lastDate = sub.lastDate;
      if (!existing.merchant && sub.merchant) existing.merchant = sub.merchant;
      if (!existing.id && sub.id) existing.id = sub.id;
    } else {
      map.set(key, { ...sub });
    }
  };
  gmail.forEach(add);
  paypal.forEach(add);
  truelayer.forEach(add);
  return Array.from(map.values());
}

function flagNewSubscriptions(
  gmailSubs: SubscriptionMatch[],
  paypalSubs: SubscriptionMatch[],
  truelayerSubs: SubscriptionMatch[],
  gmailInvoices: GmailInvoice[]
): FlaggedSubscription[] {
  const paypalKeys = new Set(paypalSubs.map(s => normalizeName(s.name)));
  const truelayerKeys = new Set(truelayerSubs.map(s => normalizeName(s.name)));
  const flagged: FlaggedSubscription[] = [];

  for (const gmailSub of gmailSubs) {
    const key = normalizeName(gmailSub.name);
    if (paypalKeys.has(key) || truelayerKeys.has(key)) continue;
    const evidence = gmailInvoices.filter(inv => {
      const merchant = inv.merchant || extractMerchantFromSubject(inv.subject);
      return normalizeName(merchant) === key;
    });
    flagged.push({
      name: gmailSub.name,
      gmailEvidence: evidence,
      paypalEvidence: [],
      truelayerEvidence: [],
      reason: 'Detected in Gmail but not found in PayPal or bank transactions',
    });
  }
  return flagged;
}

function computeMonthlySpend(
  gmailInvoices: GmailInvoice[],
  paypalTransactions: PayPalTransaction[],
  truelayerAccounts: TrueLayerAccount[]
): MonthlySpend[] {
  const byMonth = new Map<string, { total: number; currency: string; byCategory: Map<string, number>; topSubs: Map<string, number> }>();

  const add = (month: string | undefined, amount: number | undefined, currency: string | undefined, category: string | undefined, name: string | undefined) => {
    if (!month || amount === undefined) return;
    const cur = currency || 'GBP';
    const key = month;
    let entry = byMonth.get(key);
    if (!entry) {
      entry = { total: 0, currency: cur, byCategory: new Map(), topSubs: new Map() };
      byMonth.set(key, entry);
    }
    entry.total += amount;
    if (category) {
      entry.byCategory.set(category, (entry.byCategory.get(category) ?? 0) + amount);
    }
    if (name) {
      entry.topSubs.set(name, (entry.topSubs.get(name) ?? 0) + amount);
    }
  };

  for (const inv of gmailInvoices) {
    const month = monthKey(inv.date);
    const amount = parseAmount(inv.amount);
    const merchant = inv.merchant || extractMerchantFromSubject(inv.subject);
    add(month, amount, inv.currency, 'gmail', merchant);
  }

  for (const tx of paypalTransactions) {
    const month = monthKey(tx.date);
    const amount = parseAmount(tx.amount);
    const merchant = tx.merchant || extractMerchantFromDescription(tx.description);
    add(month, amount, tx.currency, 'paypal', merchant);
  }

  for (const account of truelayerAccounts) {
    for (const tx of account.transactions ?? []) {
      const month = monthKey(tx.timestamp);
      const amount = parseAmount(tx.amount);
      const merchant = extractMerchantFromTrueLayer(tx.description, tx.merchant_name);
      add(month, amount, tx.currency, 'truelayer', merchant);
    }
  }

  const result: MonthlySpend[] = [];
  for (const [month, entry] of byMonth) {
    const byCategory: Record<string, number> = {};
    for (const [cat, val] of entry.byCategory) byCategory[cat] = val;
    const topSubscriptions = Array.from(entry.topSubs.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    result.push({
      month,
      total: entry.total,
      currency: entry.currency,
      byCategory,
      topSubscriptions,
    });
  }
  return result.sort((a, b) => a.month.localeCompare(b.month));
}

// --- Main entry point ---

export function consolidateFinanceData(input: FinanceInput): ConsolidationResult {
  const gmailInvoices = input.gmailInvoices ?? [];
  const paypalTransactions = input.paypalTransactions ?? [];
  const paypalSubscriptions = input.paypalSubscriptions ?? [];
  const truelayerAccounts = input.truelayerAccounts ?? [];

  const gmailSubs = buildGmailSubscriptions(gmailInvoices);
  const paypalSubs = buildPayPalSubscriptions(paypalTransactions, paypalSubscriptions);
  const truelayerSubs = buildTrueLayerSubscriptions(truelayerAccounts);

  const subscriptions = mergeSubscriptions(gmailSubs, paypalSubs, truelayerSubs);
  const flaggedNewSubscriptions = flagNewSubscriptions(gmailSubs, paypalSubs, truelayerSubs, gmailInvoices);
  const monthlySpend = computeMonthlySpend(gmailInvoices, paypalTransactions, truelayerAccounts);

  const totalMonthlySpend = monthlySpend.reduce((sum, m) => sum + m.total, 0);
  const currency = monthlySpend[0]?.currency ?? 'GBP';

  return {
    subscriptions,
    flaggedNewSubscriptions,
    monthlySpend,
    summary: {
      totalSubscriptions: subscriptions.length,
      flaggedCount: flaggedNewSubscriptions.length,
      totalMonthlySpend,
      currency,
    },
  };
}
