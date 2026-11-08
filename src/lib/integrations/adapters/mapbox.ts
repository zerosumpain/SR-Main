import { registerIntegrationAdapter } from '../registry';

// The browser map token behind every map on /health (served by
// /api/maps/config). Hand-written, not generated: it has no workflow node.
//
// #871 deleted this file with Main's map code, and without an adapter the
// credential fell into the page's "Orphaned credentials" block — its only
// action a Delete button. It was deleted from there on 2026-10-31 and every
// map went blank. Registering it gives it a proper section with Replace.
//
// No testCredential: the token is URL-restricted, Mapbox enforces that on the
// Referer, and a server request sends none — a server probe would 403 a good
// token. The browser map load is the test.
registerIntegrationAdapter({ integrationType: 'mapbox' });
