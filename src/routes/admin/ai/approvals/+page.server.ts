import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { getApprovalUiSettings, setApprovalUiSettings, type ApprovalUiSettings } from '$lib/server/models/settings';

export const load: PageServerLoad = async () => {
  return { settings: await getApprovalUiSettings() };
};

const ACTIONS = new Set<ApprovalUiSettings['defaultAction']>([
  'approve', 'approve_always', 'deny', 'none',
]);

export const actions: Actions = {
  save: async ({ request }) => {
    const data = await request.formData();
    const defaultAction = String(data.get('defaultAction') ?? 'none') as ApprovalUiSettings['defaultAction'];
    const seconds = Number(data.get('autoSelectSeconds') ?? 20);

    if (!ACTIONS.has(defaultAction)) {
      return fail(400, { error: `Invalid defaultAction: ${defaultAction}` });
    }
    if (!Number.isFinite(seconds) || seconds < 3 || seconds > 600) {
      return fail(400, { error: 'autoSelectSeconds must be between 3 and 600' });
    }

    await setApprovalUiSettings({
      defaultAction,
      autoSelectMs: Math.round(seconds * 1000),
    });
    return { saved: true };
  },
};
