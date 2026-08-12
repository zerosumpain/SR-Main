import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSubscriptionRenewals } from './subscriptionRenewalCalendar';

// Mock the platform module
vi.mock('$lib/platform', () => ({
  platform: {
    call: vi.fn(),
  },
}));

import { platform } from '$lib/platform';
const mockPlatformCall = platform.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processSubscriptionRenewals', () => {
  it('should return zero subscriptions when no data sources return anything', async () => {
    mockPlatformCall.mockImplementation(async (name: string) => {
      if (name === 'datastore_query') return { items: [] };
      if (name === 'gmail_subscription_invoices') return [];
      if (name === 'paypal_subscriptions_list') return [];
      return {};
    });

    const result = await processSubscriptionRenewals();
    expect(result.subscriptionsFound).toBe(0);
    expect(result.remindersScheduled).toBe(0);
  });

  it('should merge Gmail and PayPal subscriptions and schedule reminders', async () => {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockPlatformCall.mockImplementation(async (name: string, args?: any) => {
      if (name === 'datastore_query') return { items: [] };
      if (name === 'gmail_subscription_invoices') {
        return [
          { from: 'Netflix', subject: 'Your Netflix subscription', date: new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000).toISOString(), snippet: 'Monthly subscription' },
        ];
      }
      if (name === 'paypal_subscriptions_list') {
        return [
          { id: 'I-ABC123', name: 'Spotify Premium', next_billing_time: threeDaysFromNow + 'T00:00:00Z', status: 'ACTIVE', amount: { value: '9.99', currency_code: 'USD' } },
          { id: 'I-DEF456', name: 'Adobe CC', next_billing_time: thirtyDaysFromNow + 'T00:00:00Z', status: 'ACTIVE', amount: { value: '52.99', currency_code: 'USD' } },
        ];
      }
      if (name === 'datastore_save' || name === 'datastore_update') {
        return {};
      }
      if (name === 'schedule_reply_at') {
        return {};
      }
      return {};
    });

    const result = await processSubscriptionRenewals();
    expect(result.subscriptionsFound).toBe(3);
    expect(result.remindersScheduled).toBe(1); // Only Spotify is within 7 days

    // Verify schedule_reply_at was called once
    const scheduleCalls = mockPlatformCall.mock.calls.filter((c: any) => c[0] === 'schedule_reply_at');
    expect(scheduleCalls.length).toBe(1);
    expect(scheduleCalls[0][1].message).toContain('Spotify Premium');
  });

  it('should update existing subscriptions with newer renewal dates', async () => {
    const existingSub = {
      id: 'paypal-Spotify Premium',
      name: 'Spotify Premium',
      provider: 'paypal',
      renewalDate: '2026-09-01',
      status: 'active',
      lastDetectedAt: '2026-08-01T00:00:00Z',
    };

    mockPlatformCall.mockImplementation(async (name: string, args?: any) => {
      if (name === 'datastore_query') return { items: [existingSub] };
      if (name === 'gmail_subscription_invoices') return [];
      if (name === 'paypal_subscriptions_list') {
        return [
          { id: 'I-ABC123', name: 'Spotify Premium', next_billing_time: '2026-09-15T00:00:00Z', status: 'ACTIVE', amount: { value: '9.99', currency_code: 'USD' } },
        ];
      }
      if (name === 'datastore_save') return {};
      if (name === 'schedule_reply_at') return {};
      return {};
    });

    const result = await processSubscriptionRenewals();
    expect(result.subscriptionsFound).toBe(1); // merged, so still 1

    // Check that save was called with updated date
    const saveCalls = mockPlatformCall.mock.calls.filter((c: any) => c[0] === 'datastore_save');
    expect(saveCalls.length).toBe(1);
    const savedSub = saveCalls[0][1].item;
    expect(savedSub.renewalDate).toBe('2026-09-15'); // newer date wins
  });
});
