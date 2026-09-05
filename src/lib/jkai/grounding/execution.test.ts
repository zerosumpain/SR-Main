import { expect, it } from 'vitest';
import { withExecution, currentExecution } from './execution';
it('keeps concurrent callers scopes separate across asynchronous work', async () => {
  const read = (name: string) => withExecution({ emit: () => {}, allowedTools: [name] }, async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return currentExecution()?.allowedTools;
  });
  expect(await Promise.all([read('calendar'), read('memory')])).toEqual([['calendar'], ['memory']]);
  expect(currentExecution()).toBeUndefined();
});
