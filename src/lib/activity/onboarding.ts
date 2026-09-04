import type { ConnectionMode } from './contracts';

export const ACTIVITY_ONBOARDING_STEPS = [
  'Understand',
  'Authorize',
  'Verify',
  'Choose uses',
  'Initial sync',
  'Review',
] as const;

export interface ActivityOnboardingGuide {
  providerId: string;
  method: string;
  estimatedTime: string;
  actionLabel: string;
  actionDescription: string;
  prerequisites: string[];
  receives: string[];
  neverReceives: string[];
  preparation?: {
    label: string;
    url: string;
    steps: string[];
    waitNote?: string;
  };
}

const guides: Record<string, ActivityOnboardingGuide> = {
  steam: {
    providerId: 'steam',
    method: 'Secure Steam sign-in',
    estimatedTime: 'About 2 minutes',
    actionLabel: 'Continue with Steam',
    actionDescription:
      'Steam opens in a separate page and confirms which account you control. JKAI then uses its own server credential to read the activity Steam makes visible.',
    prerequisites: [
      'A Steam account you can sign in to',
      'Game details visible to the account if you want library and playtime data',
    ],
    receives: ['Your verified Steam ID', 'Visible game library and playtime totals', 'Visible achievements'],
    neverReceives: ['Your Steam password', 'Payment details', 'Permission to modify your Steam account'],
  },
  apple_music: {
    providerId: 'apple_music',
    method: 'Apple Music authorization',
    estimatedTime: 'About 2 minutes',
    actionLabel: 'Allow Apple Music access',
    actionDescription:
      'MusicKit handles Apple sign-in and returns a revocable Music User Token. JKAI encrypts that token and uses it only for read-only Apple Music requests.',
    prerequisites: ['An Apple Music account', 'Browser access to the Apple sign-in and consent window'],
    receives: ['A revocable Music User Token', 'Items in Apple Music’s recent list', 'Basic track and artist metadata'],
    neverReceives: ['Your Apple ID password', 'Payment details', 'Exact play time or completed-listen duration'],
  },
  youtube_takeout: {
    providerId: 'youtube_takeout',
    method: 'Google Takeout archive',
    estimatedTime: 'Upload takes minutes; Google may take longer to prepare the export',
    actionLabel: 'Continue to archive upload',
    actionDescription:
      'You request a copy from Google and upload the ZIP yourself. JKAI does not connect to your Google account or ask for a Google password.',
    prerequisites: ['A Google Takeout ZIP containing YouTube and YouTube Music watch history', 'JSON history files and a ZIP no larger than 100 MB'],
    receives: ['The ZIP you explicitly upload', 'Timestamped history records recognized during inspection'],
    neverReceives: ['Your Google password', 'Ongoing access to your Google account', 'Unrecognized files as activity events'],
    preparation: {
      label: 'Create a Google Takeout export',
      url: 'https://takeout.google.com/',
      steps: [
        'Deselect all products, then select YouTube and YouTube Music.',
        'Within that product, include history and choose JSON when the format option is offered.',
        'Choose ZIP, create the export, and download it to this device.',
      ],
      waitNote: 'Google sends a notification when the archive is ready. You can leave this setup and return later.',
    },
  },
  apple_podcasts: {
    providerId: 'apple_podcasts',
    method: 'Apple privacy export or device bridge',
    estimatedTime: 'Not yet open for connections',
    actionLabel: 'Review planned setup',
    actionDescription:
      'Apple does not currently provide a listener-history sign-in API for podcasts. JKAI will accept an export only after its playback fields have been verified.',
    prerequisites: ['A usable Apple privacy export, or the future JKAI device bridge'],
    receives: ['Only playback evidence verified in the selected export or emitted by your device'],
    neverReceives: ['Your Apple ID password', 'Publisher analytics presented as your listening history', 'Guessed plays from catalogue metadata'],
    preparation: {
      label: 'Open Apple’s data and privacy portal',
      url: 'https://privacy.apple.com/',
      steps: [
        'Request a copy of the data associated with your Apple account.',
        'Keep the downloaded archive private while the JKAI importer remains in validation.',
      ],
      waitNote: 'The UI will not accept this archive until a real export proves that listener playback fields are present.',
    },
  },
  reddit_archive: {
    providerId: 'reddit_archive',
    method: 'Reddit account archive',
    estimatedTime: 'Reddit may take up to 30 days to prepare the archive',
    actionLabel: 'Continue to archive upload',
    actionDescription:
      'You request your archive from Reddit and upload it yourself. Live Reddit authorization remains off until API access is approved.',
    prerequisites: ['A Reddit data-request ZIP downloaded from the account you want to connect'],
    receives: ['Only the archive you choose', 'Recognized account activity after an inspection preview'],
    neverReceives: ['Your Reddit password', 'Live account access', 'Raw post or comment text without a separate permission'],
    preparation: {
      label: 'Request your Reddit data',
      url: 'https://www.reddit.com/settings/data-request',
      steps: [
        'Sign in to the Reddit account you want to export.',
        'Submit the data request and wait for Reddit’s notification.',
        'Download the archive, then return here to inspect it before importing.',
      ],
      waitNote: 'Reddit says archive preparation may take up to 30 days.',
    },
  },
  github: {
    providerId: 'github',
    method: 'GitHub authorization',
    estimatedTime: 'Not yet open for connections',
    actionLabel: 'Continue with GitHub',
    actionDescription:
      'GitHub will show the repositories and account permissions being requested before returning a revocable token to JKAI.',
    prerequisites: ['A GitHub account', 'A choice about whether private-repository activity should be included'],
    receives: ['The account and repository activity covered by the approved scope'],
    neverReceives: ['Your GitHub password', 'Repository access outside the approved installation', 'Permission to change code'],
  },
};

function genericGuide(providerId: string, mode: ConnectionMode): ActivityOnboardingGuide {
  const isImport = mode === 'import';
  return {
    providerId,
    method: isImport ? 'Archive import' : 'Provider authorization',
    estimatedTime: 'A few minutes',
    actionLabel: isImport ? 'Continue to archive upload' : 'Continue to authorization',
    actionDescription: isImport
      ? 'You choose the archive to upload. It is inspected before any activity events are created.'
      : 'The provider handles sign-in and returns revocable, read-only access to JKAI.',
    prerequisites: [isImport ? 'An export from the provider' : 'An account with the provider'],
    receives: [isImport ? 'Only the archive you select' : 'Only the access shown on the provider consent screen'],
    neverReceives: ['Your provider password', 'Permission to change the source account'],
  };
}

export function getActivityOnboardingGuide(
  providerId: string,
  mode: ConnectionMode,
): ActivityOnboardingGuide {
  return guides[providerId] ?? genericGuide(providerId, mode);
}
