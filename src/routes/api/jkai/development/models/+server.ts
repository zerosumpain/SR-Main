import { json } from '@sveltejs/kit';
import { developmentModels } from '$lib/jkai/development-models.server';
import { resolveBuilderModel } from '$lib/server/models/workload-settings';
export const GET = async () => json({ models: await developmentModels(), defaultModel: await resolveBuilderModel() });
