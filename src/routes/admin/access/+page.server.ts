import type { PageServerLoad } from './$types';
import { loadAccessPage } from '$lib/server/access-page';

export const load: PageServerLoad = async () => loadAccessPage();
