import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSubscriptionDetection } from './pipeline';

// Mock platform call
vi.mock('$lib/platform', () => ({
  platform: {
    call: vi.fn()
  }
}));

// Mock datastore
vi.mock('$lib/datastore', () => ({
  datastore: {
    save: vi.fn().mockResolvedValue(undefined)
  }
}));

import { platform } from '$lib/platform';
import { datastore } from '$lib/datastore';

describe('runSubscriptionDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations (return minimal valid data)
    vi.mocked(platform.call).mockImplementation((tool: string) => {
      if (tool === 'truelayer_accounts') {
        return Promise.resolve({
          accounts: [
            {
              transactions: [
                {
                  transaction_id: 'tl-1',
                  amount: 9.99,
                  currency: 'GBP',
                  description: 'Spotify',
                  timestamp: '2026-01-15T10:00:00Z'
                },
                {
                  transaction_id: 'tl-2',
                  amount: 14.99,
                  currency: 'GBP',
                  description: 'Netflix',
                  timestamp: '2026-01-14T12:00:00Z'
                }
              ]
            }
          ]
        });
      }
      if (tool === 'gmail_subscription_invoices') {
        return Promise.resolve({
          invoices: [
            {
              messageId: 'gm-1',
              amount: 14.99,
              currency: 'GBP',
              sender: 'Netflix',
              subject: 'Your monthly Netflix subscription',
              date: '2026-01-14T12:00:00Z'
            },
            {
              messageId: 'gm-2',
              amount: 5.99,
              currency: 'GBP',
              sender: 'Patreon',
              subject: 'Patreon payment',
              date: '2026-01-13T08:00:00Z'
            }
          ]
        });
      }
      if (tool === 'subscription_detector') {
        return Promise.resolve({
          subscriptions: [
            {
              sourceId: 'existing-1',
              name: 'Netflix',
              amount: 14.99,
              currency: 'GBP',
              frequency: 'monthly',
              detectedAt: '2025-12-01T00:00:00Z'
            }
          ]
        });
      }
      return Promise.reject(new Error(`Unexpected tool: ${tool}`));
    });
  });

  it('should return a detection run with runId and timestamp', async () => {
    const result = await runSubscriptionDetection();
    expect(result).toHaveProperty('runId');
    expect(typeof result.runId).toBe('string');
    expect(result).toHaveProperty('timestamp');
    expect(result.timestamp instanceof Date).toBe(true);
    expect(result).toHaveProperty('subscriptions');
    expect(Array.isArray(result.subscriptions)).toBe(true);
  });

  it('should mark known subscriptions as active when still detected', async () => {
    const result = await runSubscriptionDetection();
    const netflix = result.subscriptions.find(s => s.name === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.status).toBe('active');
    expect(netflix!.source).toBe('matched');
  });

  it('should mark new subscriptions from TrueLayer', async () => {
    const result = await runSubscriptionDetection();
    const spotify = result.subscriptions.find(s => s.name === 'Spotify');
    expect(spotify).toBeDefined();
    expect(spotify!.status).toBe('new');
    expect(spotify!.source).toBe('truelayer');
  });

  it('should mark new subscriptions from Gmail', async () => {
    const result = await runSubscriptionDetection();
    const patreon = result.subscriptions.find(s => s.name?.includes('Patreon'));
    expect(patreon).toBeDefined();
    expect(patreon!.status).toBe('new');
    expect(patreon!.source).toBe('gmail');
  });

  it('should mark a known subscription as cancelled if not detected', async () => {
    // Run once to get the known subscription, then alter mocks
    const firstResult = await runSubscriptionDetection();
    expect(firstResult.subscriptions.some(s => s.name === 'Netflix' && s.status === 'active')).toBe(true);

    // Now simulate that Netflix is no longer seen in new data
    vi.mocked(platform.call).mockImplementation((tool: string) => {
      if (tool === 'truelayer_accounts') {
        return Promise.resolve({
          accounts: [
            {
              transactions: [
                {
                  transaction_id: 'tl-1',
                  amount: 9.99,
                  currency: 'GBP',
                  description: 'Spotify',
                  timestamp: '2026-01-15T10:00:00Z'
                }
              ]
            }
          ]
        });
      }
      if (tool === 'gmail_subscription_invoices') {
        return Promise.resolve({
          invoices: [
            {
              messageId: 'gm-2',
              amount: 5.99,
              currency: 'GBP',
              sender: 'Patreon',
              subject: 'Patreon payment',
              date: '2026-01-13T08:00:00Z'
            }
          ]
        });
      }
      if (tool === 'subscription_detector') {
        return Promise.resolve({
          subscriptions: [
            {
              sourceId: 'existing-1',
              name: 'Netflix',
              amount: 14.99,
              currency: 'GBP',
              frequency: 'monthly',
              detectedAt: '2025-12-01T00:00:00Z'
            }
          ]
        });
      }
      return Promise.reject(new Error(`Unexpected tool: ${tool}`));
    });

    const secondResult = await runSubscriptionDetection();
    const netflix = secondResult.subscriptions.find(s => s.name === 'Netflix');
    expect(netflix).toBeDefined();
    expect(netflix!.status).toBe('cancelled');
  });

  it('should persist the run to datastore', async () => {
    const result = await runSubscriptionDetection();
    expect(datastore.save).toHaveBeenCalledWith(
      'subscription_detection_runs',
      result.runId,
      expect.objectContaining({ timestamp: expect.any(Date) })
    );
  });

  it('should handle errors from individual fetchers gracefully', async () => {
    vi.mocked(platform.call).mockRejectedValue(new Error('Network error'));
    const result = await runSubscriptionDetection();
    // Should still return a run with empty subscriptions
    expect(result).toHaveProperty('runId');
    expect(result).toHaveProperty('timestamp');
    expect(result.subscriptions).toEqual([]);
  });
});
