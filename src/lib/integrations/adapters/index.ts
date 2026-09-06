// Side-effect imports for every integration adapter. Each module calls
// registerIntegrationAdapter() at load time. Imported once from
// hooks.server.ts so the registrations fire on server boot.
import './apple-calendar';
import './mapbox';
