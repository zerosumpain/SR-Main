import type { Installation, ReleaseNotes, UpgradeRepository } from '$lib/inventory-upgrades/repository';

export type CompatibilityStatus = 'compatible' | 'needs-review' | 'incompatible';
export type PlanStatus = 'ready' | 'needs-review' | 'blocked';

export interface CompatibilityAssessment {
  status: CompatibilityStatus;
  reasons: string[];
  currentVersion: string;
  targetVersion: string;
}

export interface UpgradePlan {
  component: string;
  environment: string;
  currentVersion: string;
  targetVersion: string;
  status: PlanStatus;
  assessment: CompatibilityAssessment;
  steps: string[];
  releaseNotes: ReleaseNotes | null;
}

export interface ReleaseNotesFetcher {
  fetch(input: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

export interface RecordInstallationInput {
  component: string;
  environment: string;
  version: string;
  sourceUrl?: string;
}

export interface PrepareUpgradeInput {
  component: string;
  environment: string;
  targetVersion: string;
  minimumSupportedVersion?: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function id(): string {
  return crypto.randomUUID();
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function extractBreakingChanges(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .filter((line) => /\b(breaking|migration|required action|deprecated)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export class UpgradeAnalysisService {
  constructor(
    private readonly repository: UpgradeRepository,
    private readonly releaseNotesFetcher: ReleaseNotesFetcher
  ) {}

  async recordInstallation(input: RecordInstallationInput, now = new Date()): Promise<Installation> {
    const installation: Installation = {
      id: id(),
      component: input.component,
      environment: input.environment,
      version: input.version,
      sourceUrl: input.sourceUrl ?? null,
      discoveredAt: now,
      updatedAt: now
    };
    await this.repository.saveInstallation(installation);
    return installation;
  }

  async refreshReleaseNotes(component: string, version: string, sourceUrl: string, now = new Date()): Promise<ReleaseNotes> {
    const response = await this.releaseNotesFetcher.fetch(sourceUrl);
    if (!response.ok) throw new Error(`Release notes fetch failed with HTTP ${response.status}`);
    const notes = (await response.text()).trim();
    if (!notes) throw new Error('Release notes response was empty');

    const releaseNotes: ReleaseNotes = {
      id: id(),
      component,
      version,
      sourceUrl,
      notes,
      breakingChanges: extractBreakingChanges(notes),
      fetchedAt: now
    };
    await this.repository.saveReleaseNotes(releaseNotes);
    return releaseNotes;
  }

  async prepareUpgrade(input: PrepareUpgradeInput): Promise<UpgradePlan> {
    const installation = await this.repository.findInstallation(input.component, input.environment);
    if (!installation) throw new Error(`No installation found for ${input.component} in ${input.environment}`);

    const releaseNotes = await this.repository.findReleaseNotes(input.component, input.targetVersion);
    const assessment = this.assessCompatibility(
      installation.version,
      input.targetVersion,
      input.minimumSupportedVersion,
      releaseNotes?.breakingChanges ?? []
    );
    const status: PlanStatus = assessment.status === 'incompatible'
      ? 'blocked'
      : assessment.status === 'needs-review'
        ? 'needs-review'
        : 'ready';

    const steps = [
      `Capture a verified backup of ${input.component} in ${input.environment}.`,
      `Record the current deployed version (${installation.version}) and confirm rollback ownership.`,
      ...(releaseNotes?.breakingChanges.length
        ? ['Review release-note actions: ' + releaseNotes.breakingChanges.join(' | ')]
        : ['Review the target release notes before deployment.']),
      `Deploy ${input.component} ${input.targetVersion} to a staging environment first.`,
      'Run smoke tests, compatibility checks, and monitoring validation in staging.',
      `Schedule production deployment with rollback to ${installation.version} available.`,
      `Verify health checks and record ${input.targetVersion} as the installed production version after approval.`
    ];

    return {
      component: input.component,
      environment: input.environment,
      currentVersion: installation.version,
      targetVersion: input.targetVersion,
      status,
      assessment,
      steps,
      releaseNotes
    };
  }

  private assessCompatibility(
    currentVersion: string,
    targetVersion: string,
    minimumSupportedVersion: string | undefined,
    breakingChanges: string[]
  ): CompatibilityAssessment {
    const reasons: string[] = [];
    const current = parseVersion(currentVersion);
    const target = parseVersion(targetVersion);
    const minimum = minimumSupportedVersion ? parseVersion(minimumSupportedVersion) : null;

    if (!current || !target) {
      return { status: 'needs-review', reasons: ['One or both versions are not valid semantic versions.'], currentVersion, targetVersion };
    }
    if (compareVersions(target, current) <= 0) {
      return { status: 'incompatible', reasons: ['Target version must be newer than the installed version.'], currentVersion, targetVersion };
    }
    if (minimum && compareVersions(current, minimum) < 0) reasons.push(`Installed version is below the supported baseline ${minimumSupportedVersion}.`);
    if (target.prerelease) reasons.push('Target version is a prerelease.');
    if (target.major > current.major) reasons.push('The upgrade crosses a major-version boundary.');
    if (breakingChanges.length) reasons.push(`Release notes contain ${breakingChanges.length} breaking or migration-related item(s).`);

    return {
      status: reasons.length ? 'needs-review' : 'compatible',
      reasons,
      currentVersion,
      targetVersion
    };
  }
}
