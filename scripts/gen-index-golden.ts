import { readFileSync } from 'node:fs';
import { appleCalendarSpec } from '../tests/__fixtures__/curate-codegen/apple-calendar.spec';
import { patchWorkflowsIndex } from '$lib/curate/codegen/index-patch';

const base = readFileSync('tests/__fixtures__/curate-codegen/index-base.ts.txt', 'utf8');
process.stdout.write(patchWorkflowsIndex(base, appleCalendarSpec));
