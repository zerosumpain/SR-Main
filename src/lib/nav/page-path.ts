import { page } from '$app/state';

/**
 * Where we are, for a component that might not be inside a request.
 *
 * `page` from `$app/state` throws outright when there is no router context —
 * `TypeError: Cannot read properties of undefined (reading 'page')` — and a
 * shared header is exactly the component people render without one: sixteen
 * HealthShell tests do it, and so would any Storybook-style harness or a
 * component embedded in a canvas node.
 *
 * A nav bar has no business crashing a page because it cannot work out which
 * cell to underline. Outside a request there is no current path, so these
 * answer "nowhere" and "not the owner" — the safe ends of both questions: no
 * cell lights, and nothing owner-only is offered.
 */
export function currentPath(): string {
  try {
    return page.url?.pathname ?? '';
  } catch {
    return '';
  }
}

export function currentIsOwner(): boolean {
  try {
    return page.data?.isOwner !== false;
  } catch {
    return false;
  }
}
