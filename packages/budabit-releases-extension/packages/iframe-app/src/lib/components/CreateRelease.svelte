<script lang="ts">
  import type { WidgetBridge } from 'budabit-sdk';
  import type { RepoContext } from '../context.js';
  import type { PipelineArtifactData } from '../pipelines.js';
  import type { ApplicationMetadata, Artifact, SoftwareApplication } from '../types.js';
  import { CHANNELS } from '../types.js';
  import { forgeArtifacts, forgeLabel, versionFromTag, type ForgeImport } from '../forge.js';
  import { loadPipelineArtifacts } from '../pipelines.js';
  import { appCoordinate } from '../trust.js';
  import { assetIssues } from '../assets.js';
  import {
    loadJournal,
    discardJournal,
    preparePublication,
    publishJournal,
    JournalConflictError,
    JournalRecoveryError,
    type PublicationJournal,
  } from '../publication.js';
  import ArtifactSelector from './ArtifactSelector.svelte';
  import { onDestroy, untrack } from 'svelte';

  let {
    bridge,
    repo,
    existingApps,
    importRelease = null,
    onSuccess,
    onCancel,
  }: {
    bridge: WidgetBridge;
    repo: RepoContext;
    existingApps: SoftwareApplication[];
    /** A forge release to import: prefills the form and supplies the assets instead of a run. */
    importRelease?: ForgeImport | null;
    onSuccess: () => void;
    onCancel: () => void;
  } = $props();
  const controller = new AbortController();
  // The import is fixed for the life of this form; App mounts a fresh form per import.
  const imported: ForgeImport | null = untrack(() => importRelease);
  const source: 'run' | 'forge' = imported ? 'forge' : 'run';
  const forgeAssets = $state<Artifact[]>(
    imported ? forgeArtifacts(imported.repo, imported.kind, imported.release) : []
  );
  onDestroy(() => controller.abort());
  let pipelineData = $state<PipelineArtifactData | null>(null);
  let loading = $state(true);
  let error = $state('');
  let appChoice = $state('');
  let appId = $state('');
  let appName = $state('');
  // Store-listing metadata (kind 32267): edited for a new application, or for an
  // existing one the signing account owns when "Update application" is enabled.
  let editApp = $state(false);
  let appMeta = $state<ApplicationMetadata>({});
  let imagesText = $state('');
  let tagsText = $state('');
  let runId = $state('');
  let version = $state(imported ? versionFromTag(imported.release.tag) : '');
  let channel = $state<string>(imported?.release.prerelease ? 'beta' : 'main');
  let notes = $state(imported?.release.notes ?? '');
  let selectedIds = $state(new Set<string>());
  // A checksum the forge publishes counts as verified; the rest are hashed in the selector.
  let verifiedIds = $state(new Set(forgeAssets.filter((a) => a.sha256).map((a) => a.eventId)));
  let submitting = $state(false);
  let progress = $state('');
  let journal = $state.raw<PublicationJournal | null>(null);
  let loadFailure = $state<'journal' | 'pipeline' | ''>('');
  let retryLoad = $state(0);
  let confirmDiscard = $state(false);
  let recoveryRevision = $state<string | undefined>();
  let conflict = $state('');
  const app = $derived(existingApps.find((a) => appCoordinate(a) === appChoice));
  const canEditApp = $derived(!!app && app.pubkey === repo.userPubkey);
  const publishesApp = $derived(!app || (canEditApp && editApp));
  const artifacts = $derived(
    source === 'forge' ? forgeAssets : (pipelineData?.artifactsByRun.get(runId) ?? [])
  );
  // NIP-82 conformance can change after selection (MIME/platform edits); block the
  // form, not only the checkbox, so a stale selection never reaches the signer.
  const selectionBlocked = $derived(
    artifacts.some((a) => selectedIds.has(a.eventId) && assetIssues(a).errors.length > 0)
  );
  const canSubmit = $derived(
    !loading &&
      !submitting &&
      !journal &&
      loadFailure !== 'journal' &&
      (source === 'forge' || (!loadFailure && !!pipelineData)) &&
      !!version.trim() &&
      selectedIds.size > 0 &&
      !selectionBlocked &&
      !!(app?.appId || appId.trim())
  );
  const lines = (text: string) =>
    text
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  function startEditingApp() {
    if (!app) return;
    appName = app.name;
    appMeta = {
      summary: app.summary ?? '',
      description: app.description,
      iconUrl: app.iconUrl ?? '',
      websiteUrl: app.websiteUrl ?? '',
      repositoryUrl: app.repositoryUrl ?? '',
      license: app.license ?? '',
      platforms: [...app.platforms],
    };
    imagesText = app.imageUrls.join('\n');
    tagsText = app.tags.join(', ');
    editApp = true;
  }
  function applicationDraft(): ApplicationMetadata {
    return {
      ...appMeta,
      imageUrls: lines(imagesText),
      tags: lines(tagsText),
    };
  }

  $effect(() => {
    void retryLoad;
    let disposed = false;
    let stage: 'journal' | 'pipeline' = 'journal';
    loading = true;
    error = '';
    loadFailure = '';
    journal = null;
    pipelineData = null;
    confirmDiscard = false;
    recoveryRevision = undefined;
    loadJournal(bridge, repo, controller.signal)
      .then(async (saved) => {
        if (disposed) return;
        journal = saved;
        recoveryRevision = saved?.revision;
        if (!saved && source === 'run') {
          stage = 'pipeline';
          const data = await loadPipelineArtifacts(bridge, repo);
          if (!disposed) pipelineData = data;
        }
        if (!disposed) loading = false;
      })
      .catch((err: unknown) => {
        if (!disposed) {
          loadFailure = stage;
          error = err instanceof Error ? err.message : String(err);
          if (err instanceof JournalRecoveryError) recoveryRevision = err.revision;
          loading = false;
        }
      });
    return () => {
      disposed = true;
    };
  });
  function refreshConflict() {
    conflict =
      'Recovery changed in another session. Review the current recovery state before continuing.';
    confirmDiscard = false;
    retryLoad++;
  }
  async function discard() {
    if (!confirmDiscard || submitting || !recoveryRevision) return;
    submitting = true;
    const snapshot = JSON.parse(JSON.stringify(repo)) as RepoContext;
    try {
      await discardJournal(bridge, snapshot, recoveryRevision, controller.signal);
      if (!controller.signal.aborted) retryLoad++;
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof JournalConflictError) refreshConflict();
        else error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      submitting = false;
    }
  }
  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }
  function verified(id: string, matches: boolean) {
    const next = new Set(verifiedIds);
    if (matches) next.add(id);
    else {
      next.delete(id);
      const selection = new Set(selectedIds);
      selection.delete(id);
      selectedIds = selection;
    }
    verifiedIds = next;
  }
  async function submit(resume = false) {
    if (submitting || (!resume && !canSubmit)) return;
    submitting = true;
    error = '';
    conflict = '';
    const snapshot = JSON.parse(JSON.stringify(repo)) as RepoContext;
    try {
      if (!journal) {
        progress =
          'Signing fixed release metadata. No events are published until all signatures are verified…';
        journal = await preparePublication(
          bridge,
          snapshot,
          {
            appId: app?.appId ?? appId.trim(),
            appPubkey: app?.pubkey ?? repo.userPubkey,
            appName: appName.trim(),
            newApplication: !app,
            updateApplication: !!app && canEditApp && editApp,
            application: publishesApp ? applicationDraft() : undefined,
            version: version.trim(),
            channel,
            releaseNotes: notes.trim(),
            artifacts: artifacts.filter(
              (a) => selectedIds.has(a.eventId) && verifiedIds.has(a.eventId)
            ),
          },
          controller.signal
        );
        recoveryRevision = journal.revision;
      }
      await publishJournal(
        bridge,
        snapshot,
        journal,
        controller.signal,
        (message) => (progress = message)
      );
      if (!controller.signal.aborted) onSuccess();
    } catch (err) {
      if (!controller.signal.aborted) {
        if (err instanceof JournalConflictError) refreshConflict();
        else {
          recoveryRevision = journal?.revision ?? recoveryRevision;
          error = `${err instanceof Error ? err.message : String(err)}${journal ? ' Some events may already be published. Resume retries the same signed event IDs.' : ''}`;
        }
      }
    } finally {
      submitting = false;
      progress = '';
    }
  }
</script>

<div class="create-release">
  <button onclick={onCancel} disabled={submitting}>← Releases</button>
  <h2>New Release</h2>
  <p>Signing as <code>{repo.userPubkey}</code></p>
  {#if loading}<p>
      {source === 'forge' ? 'Checking for a saved publication…' : 'Loading authenticated pipeline runs…'}
    </p>{/if}
  {#if journal || loadFailure === 'journal'}
    <section aria-label="Publication recovery">
      {#if journal}
        <h3>Saved signed publication</h3>
        <p>
          {journal.events.length} signed events for this repository/account. Resume does not create new
          signatures.
        </p>
        <p>Release: <code>{journal.events.at(-1)?.tags.find((t) => t[0] === 'd')?.[1]}</code></p>
        <p>Batch: <code>{journal.batchId}</code></p>
        <button disabled={submitting || loading} onclick={() => void submit(true)}
          >Resume publication</button
        >
      {:else}<h3>Saved publication could not be validated</h3>
        <p>
          Local recovery data has not been removed. Retry validation, or explicitly discard it to
          start another release.
        </p>
      {/if}
      <button disabled={submitting || loading} onclick={() => retryLoad++}>Retry recovery</button>
      {#if confirmDiscard && recoveryRevision}
        <p>
          Discarding local recovery data does not undo events already published. You will lose the
          saved batch for identical-ID retries.
        </p>
        <button disabled={submitting} onclick={() => (confirmDiscard = false)}
          >Keep recovery data</button
        >
        <button disabled={submitting} onclick={() => void discard()}>Confirm discard</button>
      {:else if recoveryRevision}
        <button disabled={submitting || loading} onclick={() => (confirmDiscard = true)}
          >Discard local recovery data</button
        >
      {/if}
    </section>
  {:else if loadFailure === 'pipeline' && source === 'run'}
    <button onclick={() => retryLoad++}>Retry loading runs</button>
  {:else}
    {#if importRelease}
      <p class="import-note">
        Importing {forgeLabel(importRelease.repo)} release
        {#if importRelease.release.url}<a
            href={importRelease.release.url}
            target="_blank"
            rel="noopener noreferrer">{importRelease.release.tag}</a
          >{:else}<code>{importRelease.release.tag}</code>{/if}
        as a Nostr release signed with your key. Review the version, notes and assets before
        publishing.
      </p>
    {/if}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={submitting || loading}>
        <legend>Application and release</legend>
        <label
          >Application <select
            bind:value={appChoice}
            onchange={() => {
              editApp = false;
            }}
          >
            <option value="">Create application under my key</option>
            {#each existingApps as existing (appCoordinate(existing))}<option
                value={appCoordinate(existing)}
                >{existing.name} — {existing.pubkey.slice(0, 12)}</option
              >{/each}
          </select></label
        >
        {#if !app}
          <label
            >App identifier <input
              bind:value={appId}
              required
              placeholder="com.example.app"
            /></label
          >
        {:else}<code>{appCoordinate(app)}</code>
          {#if canEditApp && !editApp}
            <button type="button" onclick={startEditingApp}>Update application metadata</button>
          {:else if editApp}
            <button type="button" onclick={() => (editApp = false)}>Keep current metadata</button>
          {/if}{/if}
        {#if publishesApp}
          <label>App name <input bind:value={appName} placeholder="Application name" /></label>
          <label>Summary <input bind:value={appMeta.summary} placeholder="One-line tagline" /></label>
          <label
            >Description (Markdown) <textarea bind:value={appMeta.description} rows="4"
            ></textarea></label
          >
          <label
            >Icon URL (HTTPS, Blossom recommended) <input
              bind:value={appMeta.iconUrl}
              placeholder="https://blossom.example/…png"
            /></label
          >
          <label
            >Screenshot URLs (one per line) <textarea bind:value={imagesText} rows="2"
            ></textarea></label
          >
          <label>Website <input bind:value={appMeta.websiteUrl} placeholder="https://…" /></label>
          <label
            >Repository URL (git clone) <input
              bind:value={appMeta.repositoryUrl}
              placeholder="https://…/repo.git"
            /></label
          >
          <label>License (SPDX) <input bind:value={appMeta.license} placeholder="MIT" /></label>
          <label>Tags (comma-separated) <input bind:value={tagsText} placeholder="nostr, cli" /></label>
          <p>
            Platform (<code>f</code>) tags on the application are derived from the selected assets.
            This metadata is what stores such as zapstore display; it is signed with your key.
          </p>
        {/if}
        <label>Version <input bind:value={version} required placeholder="1.2.0" /></label>
        <label
          >Channel <select bind:value={channel}
            >{#each CHANNELS as ch}<option value={ch}>{ch}</option>{/each}</select
          ></label
        >
        <p>
          The same app/version under your key replaces the previous release, even if you change
          channel.
        </p>
        <label>Release notes <textarea bind:value={notes} rows="6"></textarea></label>
        {#if source === 'run'}<label
          >Authenticated pipeline run <select
            bind:value={runId}
            onchange={() => {
              selectedIds = new Set();
              verifiedIds = new Set();
            }}
          >
            <option value="">Choose a run</option>
            {#each pipelineData?.runs ?? [] as run (run.id)}<option value={run.id}
                >{run.workflowName} · {run.branch} · {run.commitId
                  ? run.commitId.slice(0, 12)
                  : 'branch head'} · {new Date(run.createdAt * 1000).toLocaleString()}</option
              >{/each}
          </select></label
        >{/if}
      </fieldset>
      {#if source === 'forge'}<ArtifactSelector
          {artifacts}
          {selectedIds}
          {verifiedIds}
          disabled={submitting}
          source="forge"
          sourceName={importRelease ? forgeLabel(importRelease.repo) : ''}
          onToggle={toggle}
          onVerified={verified}
        />{:else if runId}{#key runId}<ArtifactSelector
            {artifacts}
            {selectedIds}
            {verifiedIds}
            disabled={submitting}
            onToggle={toggle}
            onVerified={verified}
          />{/key}{/if}
      <button type="submit" disabled={!canSubmit}>Publish Release</button>
    </form>
  {/if}
  {#if progress}<p role="status">{progress}</p>{/if}
  {#if conflict || error}<p role="alert" class="error">{conflict} {error}</p>{/if}
</div>

<style>
  .create-release {
    padding: 1.25rem;
  }
  fieldset,
  section {
    border: 1px solid var(--ext-border);
    border-radius: 6px;
    margin: 1rem 0;
    padding: 1rem;
  }
  label {
    display: block;
    margin: 0.6rem 0;
  }
  input,
  select,
  textarea {
    display: block;
    box-sizing: border-box;
    width: 100%;
    padding: 0.5rem;
    background: var(--ext-surface);
    color: var(--ext-text);
    border: 1px solid var(--ext-border);
    border-radius: 4px;
  }
  button {
    padding: 0.5rem 0.8rem;
    color: var(--ext-accent-text);
    background: var(--ext-accent);
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  p {
    color: var(--ext-text-secondary);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  code {
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--ext-danger-text);
  }
</style>
