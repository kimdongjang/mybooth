export const SYNC_INTERVAL_MS = 30_000;

// One cycle at a time; reconnect/manual requests may bypass the retry delay.
export function createBackgroundSync({upload, refresh, online, isCurrent = () => true, now = Date.now}) {
  let running = null;
  let failures = 0;
  let nextAttempt = 0;
  return function run({force = false} = {}) {
    if (!isCurrent() || !online() || (!force && now() < nextAttempt)) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      try {
        const result = await upload();
        if (!isCurrent()) return;
        if (result?.pendingCount > 0 || result?.lastError) throw new Error('Pending upload');
        if (await refresh() === false) throw new Error('Refresh failed');
        failures = 0;
        nextAttempt = 0;
      } catch {
        failures++;
        nextAttempt = now() + Math.min(SYNC_INTERVAL_MS * 2 ** Math.min(failures - 1, 4), 300_000);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}
