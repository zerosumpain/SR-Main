import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { insightMembers, loadPresenceInsights } from '$lib/home/presence/insights.server';

export const load: PageServerLoad = async event => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  event.depends('home:insights');
  const askedDays = Number(event.url.searchParams.get('days'));
  const days = [7, 28, 90].includes(askedDays) ? askedDays : 28;
  const members = await insightMembers({ kind: 'owner' }).catch(() => []);
  const asked = event.url.searchParams.get('person');
  const person = members.some(m => m.subject === asked) ? asked : null;
  try {
    return { insights: await loadPresenceInsights({ kind: 'owner' }, days, person), days, person,
      members: members.map(m => ({ subject: m.subject, displayName: m.displayName })), loadError: null };
  } catch {
    return { insights: null, days, person, members: [], loadError: 'The trail could not be read. Refresh to try again; missing data is not counted as zero.' };
  }
};
