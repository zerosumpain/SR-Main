let interval: ReturnType<typeof setInterval> | undefined;
let startup: ReturnType<typeof setTimeout> | undefined;
let running = false;
let syncing = false;

export function startScheduler() {
  if (running) return;
  running = true;

  const requested = Number(process.env.SYNC_INTERVAL_MS ?? '3600000');
  const ms = Number.isFinite(requested) && requested > 0 ? requested : 3600000;
  console.log(`[scheduler] Health sync every ${Math.round(ms / 60000)} minutes`);

  // First sync after 30 seconds (let app fully start)
  startup = setTimeout(() => {
    startup = undefined;
    if (!running) return;
    void runSync();
    interval = setInterval(() => void runSync(), ms);
  }, 30000);
}

async function runSync() {
  if (!running || syncing) return;
  syncing = true;
  try {
    console.log('[scheduler] Starting health sync...');
    const { syncAll } = await import('./sync-service');
    const result = await syncAll({ fullBackfill: false, maxPages: 1 });
    console.log('[scheduler] Sync complete:', JSON.stringify(result));
  } catch (e) {
    console.error('[scheduler] Sync failed:', e instanceof Error ? e.message : e);
  } finally {
    syncing = false;
  }
}

export function stopScheduler() {
  running = false;
  if (startup) {
    clearTimeout(startup);
    startup = undefined;
  }
  if (interval) {
    clearInterval(interval);
    interval = undefined;
  }
}
