import { readFileSync, writeFileSync } from 'node:fs';
import { appleCalendarSpec } from '../tests/__fixtures__/curate-codegen/apple-calendar.spec';
import { patchPanelRegistry } from '$lib/curate/codegen/registry-patch';

const base = readFileSync('tests/__fixtures__/curate-codegen/registry-base.ts.txt', 'utf8');
process.stdout.write(patchPanelRegistry(base, appleCalendarSpec));
