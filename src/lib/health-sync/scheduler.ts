let interval: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startScheduler() {
  if (running) return;
  running = true;

  const ms = parseInt(process.env.SYNC_INTERVAL_MS || '3600000');
  console.log(`[scheduler] Health sync every ${Math.round(ms / 60000)} minutes`);

  // First sync after 30 seconds (let app fully start)
  setTimeout(async () => {
    await runSync();
    interval = setInterval(runSync, ms);
  }, 30000);
}

async function runSync() {
  try {
    console.log('[scheduler] Starting health sync...');
    const { syncAll } = await import('./sync-service');
    const result = await syncAll({ fullBackfill: false, maxPages: 1 });
    console.log('[scheduler] Sync complete:', JSON.stringify(result));
  } catch (e) {
    console.error('[scheduler] Sync failed:', e instanceof Error ? e.message : e);
  }
}

export function stopScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
  running = false;
}
