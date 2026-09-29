# Release widget architecture

```text
Budabit repo-tab + bridge → SDK postMessage transport → Svelte widget
       │                                             │
       ├─ account signer                             ├─ context.ts: exact identities/viewer
       ├─ Welshman relay infrastructure               ├─ trust.ts: signatures/authorization/replacements
       └─ repo-scoped local storage                   ├─ query.ts: bounded complete/partial discovery
                                                     ├─ list-controller.ts: subscription/cache lifecycle
                                                     ├─ pipelines.ts: authenticated run/artifact selection
                                                     ├─ assets.ts: NIP-82 MIME/platform inference + conformance
                                                     ├─ publication.ts: pinned signing + signed journal
                                                     ├─ binary.ts: safe URLs/local-file SHA-256
                                                     └─ markdown.ts: sanitized release notes
```

The iframe never opens relay WebSockets or imports Welshman. It uses `nostr-tools` for cryptographic/event checks and `@noble/hashes` for incremental local-file hashing. Its only HTTP is `forge.ts`: unauthenticated, size-bounded GETs to the GitHub/GitLab/Gitea API of the repository named by the announcement's `clone`/`web` URL, plus, on request, one asset download streamed through SHA-256 (`binary.ts`) when the forge publishes no checksum. Forge releases are shown as unverified and can be imported into the release form as artifacts; they never enter `trust.ts` authority. The in-tree `budabit-sdk` workspace supplies transport and manifest tools. Local adapters validate host responses beyond the SDK's typed action map, including complete/partial queries and atomic storage. Subscription IDs are assigned by the host.

Kinds: application `32267`, release `30063`, asset `3063`, workflow run `5401`, build artifact `1063`, repository announcement `30617` (read once per repository for its NIP-34 `relays`, which replace the host's relay hints for discovery and publication), widget manifest `30033`. `releases.ts` parses/builds NIP-82 metadata and provides bounded data-loading/formatting helpers. `assets.ts` holds the NIP-82 Appendix A/C tables: `classifyArtifact` fills the MIME type and platforms CI artifacts rarely declare, and `assetIssues` is the single conformance check used by the selector UI and by `buildAssetEvent` before signing, so mobile and non-mobile assets are packaged identically.

`App.svelte` owns the repository authority controller across list/detail/create navigation; views consume its current application/release state rather than owning the only subscription. Detail follows its canonical release coordinate and checks current authority before and after asset loading. Revocation removes the detail's download surface.

Discovery is separate from authorization; a valid signature is not sufficient for repository membership. `trust.ts` copies and cryptographically verifies external records, deeply freezes their tags/event fields, and admits them to a private WeakSet. Only those immutable object identities can reuse verification; raw copies, public flags and matching IDs cannot. Current authorization is still recalculated, and live emissions are coalesced on a 16 ms timer instead of re-verifying every stored signature per event.

Publication freezes inputs, validates/signs every template, saves signed IDs and only then sends events. Every batch attempt revalidates application authority with current replacement discovery, including embedded app candidates and same-session retries. Partial success is recoverable, not atomic; invalid local journals have an explicit retry/confirmed-discard path.

The production Vite build is one HTML file. `test-host/` is a separate development-only entrypoint used by focused Chromium tests; it uses synthetic keys and a memory/sessionStorage wire fixture, never real relay writes.
