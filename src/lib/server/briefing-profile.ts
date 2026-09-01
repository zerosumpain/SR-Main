import { getSetting } from '$lib/server/models/settings';
import {
  normaliseBriefingProfile,
  SETTINGS_PROFILE_KEY,
  type BriefingProfile,
} from '$lib/constants/briefing';

export async function getBriefingProfile(): Promise<BriefingProfile> {
  return normaliseBriefingProfile(await getSetting(SETTINGS_PROFILE_KEY));
}
