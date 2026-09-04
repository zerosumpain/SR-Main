import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { activityErrorResponse, activityProblem } from '$lib/activity/http.server';
import { getActivityFeatureState } from '$lib/activity/providers/catalog.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';
import { createActivityImport, MAX_ACTIVITY_IMPORT_BYTES } from '$lib/activity/imports/store.server';
import { publicActivityImport } from '$lib/activity/public.server';

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const contentType = event.request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return activityProblem(415, 'multipart_required', 'Archive uploads must use multipart form data');
    }
    const declaredLength = Number(event.request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ACTIVITY_IMPORT_BYTES + 1024 * 1024) {
      return activityProblem(413, 'archive_too_large', 'Archive must be no larger than 100 MB');
    }
    const form = await event.request.formData();
    const connectionId = String(form.get('connectionId') ?? '');
    const file = form.get('file');
    if (!connectionId) return activityProblem(400, 'connection_required', 'connectionId is required');
    if (!(file instanceof File)) return activityProblem(400, 'file_required', 'A ZIP archive is required');
    if (file.size === 0 || file.size > MAX_ACTIVITY_IMPORT_BYTES) {
      return activityProblem(413, 'archive_too_large', 'Archive must be between 1 byte and 100 MB');
    }
    const connection = await requireActivityConnection(principal.id, connectionId);
    const feature = await getActivityFeatureState();
    const provider = feature.providers.find((item) => item.id === connection.provider);
    if (!provider?.canStart) {
      return activityProblem(409, 'provider_disabled', 'This import provider is not enabled');
    }
    const result = await createActivityImport({
      principalId: principal.id,
      connectionId,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return json(
      {
        import: publicActivityImport(result.activityImport),
        jobId: result.jobId,
        duplicate: result.duplicate,
      },
      { status: result.duplicate ? 200 : 202 },
    );
  } catch (error) {
    return activityErrorResponse(error);
  }
};
