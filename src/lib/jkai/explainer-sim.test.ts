// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * static/explainer-kit/sim.js, executed for real in a DOM.
 *
 * The bug this pins: `result = step({ ...values }) || {}`. An async step()
 * returns a thenable, which is truthy, so `|| {}` never caught it and every
 * outcome rendered the em-dash placeholder for the life of the page. The gate
 * then reported `inert-lever` with a remedy telling the author to "wire step()
 * so the outcome depends on the lever" — advice that is both wrong and
 * unactionable, repeated every iteration. Exactly the unfixable-finding loop
 * this project keeps getting bitten by.
 *
 * The kit is plain browser JS with no module system, so it is evaluated here
 * the way a served chapter loads it: as a script against window/document.
 */
const SRC = readFileSync('static/explainer-kit/sim.js', 'utf-8');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadKit(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).Explainer;
  new Function(SRC)();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Explainer;
}

function mount(): HTMLElement {
  document.body.innerHTML = '';
  const m = document.createElement('div');
  document.body.appendChild(m);
  return m;
}

const SPEC = (step: (v: Record<string, number>) => unknown) => ({
  mount: mount(),
  levers: [{ id: 'roll', label: 'Pupils', min: 0, max: 100, step: 1, value: 10 }],
  outcomes: [{ id: 'total', label: 'Budget', format: (n: number) => String(n) }],
  step,
});

function outcomeText(): string {
  return document.querySelector('[data-outcome="total"]')!.textContent ?? '';
}

async function settled(): Promise<void> {
  // Two macrotask hops: enough for a resolved promise chain to run its
  // continuations, without depending on a timer.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('explainer kit createSim', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('paints outcomes from a synchronous step, unchanged', () => {
    const ns = loadKit();
    ns.createSim(SPEC((v) => ({ total: v.roll * 2 })));
    expect(outcomeText()).toBe('20');
  });

  it('paints outcomes from an ASYNC step instead of leaving the placeholder', async () => {
    const ns = loadKit();
    ns.createSim(SPEC(async (v) => ({ total: v.roll * 2 })));
    // Before the fix this stayed at '—' forever and the gate called the lever
    // inert.
    expect(outcomeText()).toBe('—');
    await settled();
    expect(outcomeText()).toBe('20');
  });

  it('an async lever visibly moves its outcome — the thing the gate probes', async () => {
    const ns = loadKit();
    const sim = ns.createSim(SPEC(async (v) => ({ total: v.roll * 2 })));
    await settled();
    const before = outcomeText();
    sim.set('roll', 40);
    await settled();
    expect(outcomeText()).not.toBe(before);
    expect(outcomeText()).toBe('80');
  });

  it('lets a caller await the async recompute directly', async () => {
    const ns = loadKit();
    const sim = ns.createSim(SPEC(async (v) => ({ total: v.roll + 1 })));
    await sim.recompute();
    expect(outcomeText()).toBe('11');
  });

  it('never paints a superseded async result', async () => {
    const ns = loadKit();
    // First run resolves LAST. Without an ordering guard its stale value would
    // land on top of the newer one.
    let call = 0;
    const sim = ns.createSim(
      SPEC((v) => {
        const delay = call++ === 0 ? 30 : 0;
        return new Promise((r) => setTimeout(() => r({ total: v.roll }), delay));
      }),
    );
    sim.set('roll', 55);
    await new Promise((r) => setTimeout(r, 80));
    expect(outcomeText()).toBe('55');
  });

  it('says "error" and names the problem when an async step rejects', async () => {
    const ns = loadKit();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ns.createSim(SPEC(async () => { throw new Error('upstream 500'); }));
    await settled();
    expect(outcomeText()).toBe('error');
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toMatch(/async step\(\) rejected/);
  });

  it('keeps the existing synchronous throw behaviour', () => {
    const ns = loadKit();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ns.createSim(SPEC(() => { throw new Error('bad model'); }));
    expect(outcomeText()).toBe('error');
    expect(String(spy.mock.calls[0][0])).toMatch(/step\(\) threw/);
  });

  it('still emits lever_changed to the parent frame on an async run', async () => {
    const ns = loadKit();
    const seen: unknown[] = [];
    window.addEventListener('message', (e) => seen.push(e.data));
    ns.createSim(SPEC(async (v) => ({ total: v.roll })));
    await settled();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.some((d) => (d as { type?: string })?.type === 'lever_changed')).toBe(true);
  });
});
