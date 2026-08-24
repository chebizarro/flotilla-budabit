# Performance Diagnostics

Budabit has an opt-in diagnostics build for measuring exact Community Home routes and `/git`. The feature observes existing state; it does not initiate route requests or change loading decisions.

## Enable Capture

Build or deploy with:

```sh
VITE_PERFORMANCE_DIAGNOSTICS=1 pnpm build
```

Open **Settings → Performance Diagnostics**:

1. Enter `/git`, a full site URL, or an exact `/c/naddr...` Community Home path.
2. Choose **Arm next launch**.
3. Close and reopen the app on that route. For cold assets, clear the browser HTTP cache without clearing local storage, which holds the one-shot arm.
4. Capture starts during client bootstrap and stops at the route's settled milestone, with a 30-second failure timeout.
5. Return to Settings to inspect and download the result, or choose **Upload & publish** while logged in.

**Arm and open now** is convenient for warm-session diagnostics but does not produce a genuinely cold browser load. A small status control on the target page links back to the diagnostics settings while a capture is running or available.

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
