import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scheduleDailyDateMemory, handleDateMemorySave, cancelDailyDateMemory } from './scheduler';

// Mock the platform call
vi.mock('$lib/platform', () => ({
  call: vi.fn(),
}));

import { call } from '$lib/platform';

const mockCall = vi.mocked(call);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleDailyDateMemory', () => {
  it('should call schedule_orchestrator_turn_at with correct arguments and return callbackId', async () => {
    mockCall.mockResolvedValue({ callbackId: 'cb_123' });
    const result = await scheduleDailyDateMemory();
    expect(mockCall).toHaveBeenCalledWith('schedule_orchestrator_turn_at', {
      time: '00:00',
      tool: 'save_today_date',
    });
    expect(result).toEqual({ success: true, callbackId: 'cb_123' });
  });

  it('should return success false on error', async () => {
    mockCall.mockRejectedValue(new Error('Network error'));
    const result = await scheduleDailyDateMemory();
    expect(result).toEqual({ success: false });
  });
});

describe('handleDateMemorySave', () => {
  it('should save today\'s date in YYYY-MM-DD format', async () => {
    mockCall.mockResolvedValue({});
    const result = await handleDateMemorySave();
    const today = new Date().toISOString().split('T')[0];
    expect(mockCall).toHaveBeenCalledWith('save_memory', {
      key: 'today_date',
      value: today,
    });
    expect(result).toEqual({ success: true, date: today });
  });

  it('should return success false on error', async () => {
    mockCall.mockRejectedValue(new Error('Memory full'));
    const result = await handleDateMemorySave();
    expect(result).toEqual({ success: false });
  });
});

describe('cancelDailyDateMemory', () => {
  it('should call cancel_scheduled_callback with the given callbackId', async () => {
    mockCall.mockResolvedValue({});
    const result = await cancelDailyDateMemory('cb_456');
    expect(mockCall).toHaveBeenCalledWith('cancel_scheduled_callback', { callbackId: 'cb_456' });
    expect(result).toEqual({ success: true });
  });

  it('should return success false on error', async () => {
    mockCall.mockRejectedValue(new Error('Not found'));
    const result = await cancelDailyDateMemory('cb_789');
    expect(result).toEqual({ success: false });
  });
});
