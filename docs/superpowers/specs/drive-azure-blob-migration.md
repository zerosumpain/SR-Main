# Spec — migrate `/drive` file store to Azure Blob Storage

**Status:** in progress (autonomous, Full grade) · **Date:** 2026-07-05
**Owner:** John (kicked off "migrate services onto azure… starting with /drive… setup services autonomously")

## Goal

Move the byte storage behind `/drive` (and its WebDAV mount `/dav/`) from local disk on the
Hetzner VPS to **Azure Blob Storage**, with zero change to the `/drive` UX, the file metadata
model (Postgres `workflow_files`), or local/homeserv dev (which stays on the fs backend).

First of a planned series of service migrations onto Azure. Chosen first because the storage
layer is a single well-defined seam.

## Current architecture (verified in-repo)

- **Metadata:** Postgres `workflow_files` — `disk_path` is the storage key (absolute path under
  `WORKFLOW_FILES_ROOT`, shaped `<root>/<uuid>/<safe-name>`). Unchanged by this migration.
- **Byte seam:** `src/lib/file-store/storage.ts` — `newDiskPath / saveBuffer / readBuffer /
  appendBuffer / deleteFile / fileSize / storeRoot`. All API routes (`/api/files/*`), workflow
  nodes (`file-store`, `file-ops`), and zip/convert/extract go through it. ✅ clean seam.
- **Leak:** `src/routes/dav/[...path]/+server.ts` bypasses the seam and touches `node:fs`
  directly to **stream** (GET `createReadStream`, PUT `createWriteStream`+`pipeline`, COPY/MOVE
  `createReadStream→createWriteStream`, `stat`). Its cap is **5 GB** — buffering whole files is
  unsafe on the 8 GB box (documented OOM history). So the seam must gain streaming methods.
- **Separate store, NOT in scope:** `src/lib/jkai/media/storage.ts` (jkai attachments/intel).

## Design — dispatch seam + streaming

`storage.ts` becomes a thin dispatcher: if `AZURE_STORAGE_CONNECTION_STRING` is set →
delegate to a new `azure-blob.ts`; else → the existing fs implementation. `newDiskPath` and the
`<uuid>/<name>` key shape are preserved, so **DB rows are unchanged** and the blob name is just
`diskPath` relative to `storeRoot()`. New seam methods added for streaming:

- `saveStream(diskPath, Readable): Promise<number>` — fs: pipeline→createWriteStream; azure: `uploadStream`.
- `readStream(diskPath): Promise<Readable>` — fs: createReadStream; azure: `download().readableStreamBody`.
- `copyFile(src, dst): Promise<void>` — fs: stream copy; azure: read-stream→save-stream.

`appendBuffer` on Azure = read existing blob + concat + re-put block blob (append usage is
small logs/csv from workflow nodes; fine at low usage).

## Files to touch

| File | Change |
|---|---|
| `src/lib/file-store/azure-blob.ts` | **NEW** — lazy singleton `ContainerClient` from conn-string; buffer + stream + append + copy + exists, keyed by diskPath-relative-to-root. |
| `src/lib/file-store/storage.ts` | fs-vs-Azure dispatcher; identical existing signatures + new `saveStream`/`readStream`/`copyFile`. |
| `src/routes/dav/[...path]/+server.ts` | Replace 4 direct-fs sites with seam stream methods; keep size checks + error cleanup. |
| `package.json` | add `@azure/storage-blob`. |
| `.env.example` | document `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_BLOB_CONTAINER`. |
| `scripts/azure/provision-drive-storage.sh` | **NEW** — reproducible (idempotent) infra commands. |
| `scripts/migrate-drive-to-azure.mjs` | **NEW** — one-off, idempotent upload of existing files → blob. |
| VPS `.env` (not committed) | add the two Azure keys via deploy.sh's `grep -q || echo >>` idiom. |

## Verification (stated before coding)

1. **Local integration:** `AZURE_STORAGE_CONNECTION_STRING=… node` round-trips buffer + stream +
   append + copy against the real `drive` container; asserts bytes match; cleans up. `npm run build` green.
2. **Prod live (after deploy+migrate):** upload a file via API → download → byte-diff identical;
   download a **pre-existing** file (proves data migration); WebDAV `PUT` then `GET` via curl → byte-diff;
   `az storage blob list` shows the objects. Only then is it "done".

## Decision Log

| Fork | Options | Chosen | Why | Reversibility |
|---|---|---|---|---|
| Storage primitive | Blob Storage / Azure Files mount | **Blob Storage** | Cloud-native, cheapest, matches opaque-key model; Files is just a relocated disk. | High — swap backend module. |
| App→blob auth | Connection string / `@azure/identity` SP | **Connection string** in VPS `.env` | No extra SDK/identity wiring in Node; scoped to one account; matches how other secrets live in `.env`. | High — env-only. |
| Automation auth (me/cron) | Interactive `az login` / service principal | **Service principal** `sr-homeserv-automation`, Contributor scoped to `sr-drive-rg` | One login buys durable non-interactive infra ops incl. cron. | High — `az ad sp delete`. |
| Provisioning | Imperative `az` / Terraform-Bicep | **Imperative `az`**, captured in a script | Fastest to live for one service; script gives partial reproducibility. IaC deferred until multi-service. | Med — re-import to TF later. |
| Redundancy/tier | LRS-Hot / GRS / cool | **Standard_LRS, Hot, GPv2, private** | Cheapest; free at low usage (new-sub 5 GB/12mo grant); no standing hourly charge. Honors "prefer free-at-low-usage". | High — reconfigure. |
| Region | UK South / other | **UK South** | John UK-based; data residency + latency. | Low — new account to move. |
| DAV big-file handling | Buffer whole file / stream | **Stream** via new seam methods | 5 GB cap on 8 GB box; buffering risks OOM. | n/a — correctness. |
| Dev backend | Azure everywhere / fs locally | **fs locally, Azure on VPS only** | Keeps dev isolated from prod blob; gate on conn-string presence. | High — set/unset env. |
| Migration timing | Cut over then copy / copy then cut over | **Copy first, deploy, re-run (idempotent)** | Existing files present in blob before app reads blob → no 404 gap. | High — re-runnable. |

## Post-review hardening (code review, 2026-07-05)

Three fs↔Azure parity findings applied after go-live:
1. **ENOENT normalization** — `azReadBuffer`/`azReadStream`/`azSize` translate Azure not-found
   (`BlobNotFound`/404) into an `ENOENT`-coded error, so existing consumers that branch on
   `err.code === 'ENOENT'` (e.g. `/api/files/[id]/download` → 410) keep working unchanged.
2. **Atomic append** — `azAppendBuffer` now does an ETag-conditional re-upload (`ifMatch` / create via
   `ifNoneMatch:'*'`) with retry-on-412/409, mirroring fs `O_APPEND` atomicity so concurrent appends
   don't clobber each other.
3. **fs readStream `stat` guard** — fs branch `stat`s before `createReadStream` so a missing file
   throws before headers are committed (Azure already did via the `download()` round-trip). Dev-path fix.
