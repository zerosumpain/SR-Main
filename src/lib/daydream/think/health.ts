// src/lib/daydream/think/health.ts
//
// The think loop's health reads now live in `$lib/owner-data/health.server`
// (overhaul plan 2026-10-28, P2-2), where chat's `health_hub`,
// `health_series` and `health_activities` use the same implementation.
// Re-exported here so the toolbox (`./tools`) and its tests keep their paths.
export * from '$lib/owner-data/health.server';
