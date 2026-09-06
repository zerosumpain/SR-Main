import { getCredential, listCredentials } from '$lib/integrations/credentials';
import { isMapboxPublicToken, MAPBOX_STYLE } from './config';

export async function mapboxConfig() {
  const credentials = await listCredentials('mapbox');
  // Creating a replacement credential rotates the token without a deployment.
  credentials.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
  if (!credentials.length) return null;
  const credential = await getCredential<'apikey'>(credentials[0].id);
  if (credential?.integrationType !== 'mapbox' || credential.kind !== 'apikey'
    || !isMapboxPublicToken(credential.payload.key)) return null;
  return { accessToken: credential.payload.key, style: MAPBOX_STYLE };
}
