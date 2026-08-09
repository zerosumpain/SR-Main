import { call } from '$lib/platform';

const SCHEDULE_TIME = '00:00';
const TOOL_NAME = 'save_today_date';
const MEMORY_KEY = 'today_date';

/**
 * Schedules a daily orchestrator turn at midnight to save today's date into memory.
 * Returns the scheduled callback ID if successful.
 */
export async function scheduleDailyDateMemory(): Promise<{ success: boolean; callbackId?: string }> {
  try {
    const result = await call('schedule_orchestrator_turn_at', {
      time: SCHEDULE_TIME,
      tool: TOOL_NAME,
    });
    return { success: true, callbackId: result.callbackId };
  } catch (error) {
    console.error('Failed to schedule daily date memory save:', error);
    return { success: false };
  }
}

/**
 * Handler for the scheduled tool call. Saves today's date (YYYY-MM-DD) into memory.
 * This function is intended to be invoked by the orchestrator when the scheduled turn fires.
 */
export async function handleDateMemorySave(): Promise<{ success: boolean; date?: string }> {
  try {
    const today = new Date().toISOString().split('T')[0];
    await call('save_memory', { key: MEMORY_KEY, value: today });
    return { success: true, date: today };
  } catch (error) {
    console.error('Failed to save today\'s date to memory:', error);
    return { success: false };
  }
}

/**
 * Cancels the scheduled daily date memory save.
 * @param callbackId The ID returned from scheduleDailyDateMemory.
 */
export async function cancelDailyDateMemory(callbackId: string): Promise<{ success: boolean }> {
  try {
    await call('cancel_scheduled_callback', { callbackId });
    return { success: true };
  } catch (error) {
    console.error('Failed to cancel daily date memory schedule:', error);
    return { success: false };
  }
}
