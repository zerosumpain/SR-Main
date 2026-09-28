import { expect, it } from 'vitest';
const { load } = await import('./+page.server');
const event = (query = '') => ({ url: new URL(`https://example.test/home/people/insights${query}`) }) as unknown as Parameters<typeof load>[0];

it('forwards to the dashboard, keeping person and history', () => {
  expect(() => load(event('?days=7&person=alex'))).toThrow(expect.objectContaining({ status: 308, location: '/home/people?person=alex&days=7' }));
  expect(() => load(event())).toThrow(expect.objectContaining({ status: 308, location: '/home/people' }));
});
