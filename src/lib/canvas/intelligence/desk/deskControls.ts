// src/lib/canvas/intelligence/desk/deskControls.ts
export type DeskStatus =
  | 'draft'
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'post_processing'
  | 'complete'
  | 'failed';

export type PillHue = 'success' | 'accent' | 'neutral' | 'error';

export interface StatusPill {
  label: string;
  hue: PillHue;
}

const RUNNING: DeskStatus[] = ['phase1', 'phase2', 'phase3', 'post_processing'];

export function isRunning(status: DeskStatus): boolean {
  return RUNNING.includes(status);
}

/**
 * Maps the session status (+ live-synthesis flag) to the cockpit status pill.
 * A live synthesis run always overrides whatever the engine is doing.
 */
export function statusPill(status: DeskStatus, synthesising: boolean): StatusPill {
  if (synthesising) {
    return { label: '● synthesising', hue: 'accent' };
  }
  switch (status) {
    case 'phase1':
      return { label: '● gathering · phase 1', hue: 'success' };
    case 'phase2':
      return { label: '● gathering · phase 2', hue: 'success' };
    case 'phase3':
      return { label: '● gathering · phase 3', hue: 'success' };
    case 'post_processing':
      return { label: '● gathering · finalising', hue: 'success' };
    case 'complete':
      return { label: '● complete', hue: 'neutral' };
    case 'failed':
      return { label: '● failed', hue: 'error' };
    case 'draft':
    default:
      return { label: '● idle', hue: 'neutral' };
  }
}

export interface ControlState {
  canPause: boolean;
  canStop: boolean;
  canDeepen: boolean;
  canShare: boolean;
}

/** Which cockpit controls are actionable for the current status. */
export function controlState(status: DeskStatus, synthesising: boolean): ControlState {
  const running = isRunning(status);
  return {
    canPause: running && !synthesising,
    canStop: running,
    canDeepen: status === 'complete',
    canShare: status !== 'draft',
  };
}
