export type StatsEndpoint = 'summary' | 'trends' | 'per-node';

export interface StatsWindow {
  preset: string;
  from: string;
  to: string;
  granularity: 'hour' | 'day' | 'week';
}

export interface StatsState<T> {
  data: T | null;
  window: StatsWindow | null;
  loading: boolean;
  error: string | null;
}

export function useStats<T>(
  slug: () => string,
  endpoint: StatsEndpoint,
  period: () => string,
  refreshKey: () => number = () => 0,
) {
  let state = $state<StatsState<T>>({ data: null, window: null, loading: true, error: null });
  let abortController: AbortController | null = null;

  async function load() {
    abortController?.abort();
    abortController = new AbortController();
    state.loading = true;
    state.error = null;
    try {
      const res = await fetch(
        `/api/canvas/${slug()}/stats/${endpoint}?period=${encodeURIComponent(period())}`,
        { signal: abortController.signal },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      const json = await res.json();
      state.data = json.data as T;
      state.window = (json.window as StatsWindow) ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
    }
  }

  $effect(() => {
    slug();
    period();
    refreshKey();
    load();
  });

  return {
    get data() {
      return state.data;
    },
    get window() {
      return state.window;
    },
    get loading() {
      return state.loading;
    },
    get error() {
      return state.error;
    },
    refresh: load,
  };
}
