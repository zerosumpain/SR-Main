// The forecast Web Worker (spec §9.1, §9.8): the engine runs here so the map
// keeps its frame rate while a plan is forecast. The bundle's first-party CSP
// allows module workers (§10.10).

import { handleForecast, type ForecastCache, type ForecastRequest } from './core';

const cache: ForecastCache = { key: '', baseline: null };

self.onmessage = (e: MessageEvent<ForecastRequest>) => {
  (self as unknown as Worker).postMessage(handleForecast(e.data, cache, () => performance.now()));
};
