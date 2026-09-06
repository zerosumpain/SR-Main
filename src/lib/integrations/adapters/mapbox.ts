import { registerIntegrationAdapter } from '../registry';

// Mapbox's URL-restricted public token is tested by the browser map request;
// a server-side probe lacks its required browser Referer.
registerIntegrationAdapter({ integrationType: 'mapbox' });
