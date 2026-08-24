# Performance Diagnostics

Budabit has an opt-in diagnostics build for measuring exact Community Home routes and `/git`. The feature observes existing state; it does not initiate route requests or change loading decisions.

## Enable Capture

Build or deploy with:

```sh
VITE_PERFORMANCE_DIAGNOSTICS=1 pnpm build
```

On Community Home or `/git`, open **Perf** in the page bar:

1. Start capture.
2. Exercise or wait for the route state to settle.
3. Stop capture.
4. Download locally, or choose **Upload & publish** while logged in.

The artifact schema is `budabit-performance-run-v1`. Captures include route milestones, bounded state samples, long tasks, resources, relay scheduler snapshots, warnings, build metadata, and browser environment data. Known secret fields and secret-shaped values are redacted before serialization.

Upload defaults:

- Blossom: `https://blossom.budabit.club`
- Manifest relay: `wss://blossom.budabit.club`
- Manifest kind: `30078`
- Immutable d-tag: `budabit-performance-run:<run-id>`
- Latest d-tag: `budabit-performance-latest`

The artifact is gzip-compressed when supported and hashed before upload. The active account signs both manifests, and publication requires at least one relay acknowledgement for each event.

## Deterministic Harness

Run the production-build benchmark:

```sh
pnpm perf:roots
```

It runs serial desktop and Pixel 7 viewport/4x CPU profiles against deterministic mock relays. Each profile measures cold-data and service-worker-warm assets for an exact community fixture and `/git`. Correct fixture projection and settlement are assertions; timing values are informational.

Outputs are ignored build artifacts under `test-results/performance-roots/`:

- `desktop.json`
- `mobile-4x.json`
- `summary.md`

Use `PERF_REUSE_BUILD=1 pnpm perf:roots` only when the existing `build/` was produced by the performance preparation step and no relevant source changed.

## Retrieve

The Home Manager-managed OpenCode skill is `budabit-performance-diagnostics`. Ask it for the latest artifact or a run ID. Identity may be a local `nak-account` alias, an `npub`, or a 64-character hex pubkey; the default alias is `five`.

Retrieval is read-only. The skill selects an exact-author manifest, verifies its signature, downloads by Blossom hash, verifies byte size and SHA-256, decompresses it, validates both schemas, and only then saves final files for analysis.
