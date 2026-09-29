<script lang="ts">
  import type { Artifact } from '../types.js';
  import { PLATFORMS } from '../types.js';
  import { formatBytes, shortHash } from '../releases.js';
  import { verifyBinary } from '../binary.js';
  import { assetIssues, NIP82_MIME_TYPES } from '../assets.js';
  import { onDestroy } from 'svelte';
  const mimeOptions = Object.keys(NIP82_MIME_TYPES);
  let {
    artifacts,
    selectedIds,
    verifiedIds,
    disabled = false,
    onToggle,
    onVerified,
  }: {
    artifacts: Artifact[];
    selectedIds: Set<string>;
    verifiedIds: Set<string>;
    disabled?: boolean;
    onToggle: (id: string) => void;
    onVerified: (id: string, matches: boolean) => void;
  } = $props();
  let messages = $state<Record<string, string>>({});
  const generations = new Map<string, symbol>();
  onDestroy(() => generations.clear());
  async function check(artifact: Artifact, file?: File) {
    const generation = Symbol();
    generations.set(artifact.eventId, generation);
    onVerified(artifact.eventId, false);
    if (!file) {
      messages[artifact.eventId] = '';
      return;
    }
    messages[artifact.eventId] = 'Checking file…';
    try {
      await verifyBinary(file, artifact.sha256, artifact.size);
      if (generations.get(artifact.eventId) !== generation) return;
      onVerified(artifact.eventId, true);
      messages[artifact.eventId] = 'SHA-256 matches';
    } catch (error) {
      if (generations.get(artifact.eventId) === generation)
        messages[artifact.eventId] = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<p>
  Artifacts below come from one maintainer-authorized run. No independent-worker consensus is
  claimed. Verify a local copy before selecting it. This checks bytes, not native/APK signatures.
  MIME type and platforms are inferred from the filename per NIP-82 and can be corrected here.
</p>
{#each artifacts as artifact (artifact.eventId)}
  {@const issues = assetIssues(artifact)}
  <fieldset {disabled}>
    <legend>{artifact.filename}</legend>
    <p>
      <code title={artifact.sha256}>{shortHash(artifact.sha256)}</code> · {artifact.size ===
      undefined
        ? 'Size not declared'
        : formatBytes(artifact.size)}
      {#if artifact.attestedBy?.length}
        · co-signed by {artifact.attestedBy.length} maintainer{artifact.attestedBy.length === 1
          ? ''
          : 's'}
      {/if}
    </p>
    <!-- Inline validation, not landmark roles: the form-level status/alert regions stay unique. -->
    {#each issues.errors as issue}<p class="issue error" aria-live="polite">{issue}</p>{/each}
    {#each issues.warnings as issue}<p class="issue warning" aria-live="polite">{issue}</p>{/each}
    <label
      >Verify local file <input
        type="file"
        onchange={(e) => void check(artifact, e.currentTarget.files?.[0])}
      /></label
    >
    <span role="status">{messages[artifact.eventId] ?? ''}</span>
    <label
      ><input
        type="checkbox"
        checked={selectedIds.has(artifact.eventId)}
        disabled={!verifiedIds.has(artifact.eventId) || disabled || issues.errors.length > 0}
        onchange={() => onToggle(artifact.eventId)}
      />
      Include {artifact.filename}</label
    >
    <label
      >MIME type (NIP-82 Appendix C) <select
        aria-label={`MIME type ${artifact.filename}`}
        bind:value={artifact.mimeType}
      >
        {#if !mimeOptions.includes(artifact.mimeType)}<option value={artifact.mimeType}
            >{artifact.mimeType} (not classified by NIP-82)</option
          >{/if}
        {#each mimeOptions as mime}<option value={mime}>{mime}</option>{/each}
      </select></label
    >
    <label
      >Asset identifier <input
        aria-label={`Asset identifier ${artifact.filename}`}
        bind:value={artifact.appId}
        placeholder="Defaults to app identifier"
      /></label
    >
    <label
      >Asset version <input
        aria-label={`Asset version ${artifact.filename}`}
        bind:value={artifact.version}
        placeholder="Defaults to release version"
      /></label
    >
    <label
      >Platforms (NIP-82 Appendix A; none = every architecture of the implied platform) <select
        multiple
        size="5"
        aria-label={`Platforms ${artifact.filename}`}
        bind:value={artifact.platforms}
      >
        {#each PLATFORMS as platform}<option value={platform}>{platform}</option>{/each}
      </select></label
    >
    {#if artifact.mimeType === 'application/vnd.android.package-archive'}
      <label
        >APK version code <input
          type="number"
          min="0"
          step="1"
          bind:value={artifact.versionCode}
        /></label
      >
      <label
        >APK certificate SHA-256 hashes (comma-separated) <input
          value={(artifact.apkCertificateHashes ?? []).join(', ')}
          oninput={(e) =>
            (artifact.apkCertificateHashes = e.currentTarget.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean))}
        /></label
      >
      <p>
        Obtain APK metadata using a trusted APK inspection tool. Entering a certificate hash is an
        assertion, not certificate verification.
      </p>
    {/if}
  </fieldset>
{/each}
{#if artifacts.length === 0}<p>No authenticated artifacts were found for this run.</p>{/if}

<style>
  fieldset {
    margin: 0.75rem 0;
    border: 1px solid var(--ext-border);
    border-radius: 6px;
  }
  label {
    display: block;
    margin: 0.5rem 0;
  }
  input:not([type='checkbox']) {
    display: block;
    max-width: 95%;
    padding: 0.3rem;
    color: var(--ext-text);
    background: var(--ext-surface);
    border: 1px solid var(--ext-border);
  }
  p {
    font-size: 0.8rem;
    color: var(--ext-text-secondary);
  }
  select {
    display: block;
    max-width: 95%;
    padding: 0.3rem;
    color: var(--ext-text);
    background: var(--ext-surface);
    border: 1px solid var(--ext-border);
  }
  .issue.error {
    color: var(--ext-danger-text);
  }
  .issue.warning {
    color: var(--ext-warning-text);
  }
</style>
