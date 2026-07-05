// `archiver` ships no bundled type declarations and we don't want to pull in
// @types/archiver just for the /api/files/download-zip endpoint. A minimal
// ambient declaration keeps svelte-check/tsc happy (the module is used as `any`).
declare module 'archiver';
