<script lang="ts">
  import type { NostrEvent } from 'budabit-sdk';
  import { formatDate, parseReleaseListItem, platformLabel, tagValues } from '../releases.js';
  import type { ListState } from '../list-controller.js';
  import { forgeLabel, type ForgeRelease, type ForgeState } from '../forge.js';
  let {
    list,
    forge,
    onRetry,
    onRefreshForge,
    isMaintainer,
    onViewRelease,
    onCreateRelease,
    onImport,
  }: {
    list: ListState;
    forge: ForgeState;
    onRetry: () => void;
    onRefreshForge: () => void;
    isMaintainer: boolean;
    onViewRelease: (event: NostrEvent) => void;
    onCreateRelease: () => void;
    onImport: (release: ForgeRelease) => void;
  } = $props();
  const PAGE = 20;
  // Signed Nostr releases and the forge's own listing are separate tabs: the
  // forge tab is unverified and never part of authority, but reads the same.
  let tab = $state<'nostr' | 'forge'>('nostr');
  let version = $state(''),
    platform = $state('all'),
    days = $state('all'),
    page = $state(1);
  const forgeName = $derived(forge.repo ? forgeLabel(forge.repo) : '');
  const since = $derived(days === 'all' ? 0 : Date.now() / 1000 - Number(days) * 86400);
  const needle = $derived(version.trim().toLowerCase());
  const platforms = $derived([...new Set(list.events.flatMap((e) => tagValues(e, 'f')))].sort());
  const filtered = $derived(
    list.events.filter((e) => {
      const item = parseReleaseListItem(e);
      return (
        item.version.toLowerCase().includes(needle) &&
        (platform === 'all' || tagValues(e, 'f').includes(platform)) &&
        e.created_at >= since
      );
    })
  );
  const forgeFiltered = $derived(
    forge.releases.filter(
      (r) =>
        `${r.tag} ${r.name}`.toLowerCase().includes(needle) && (r.publishedAt ?? 0) >= since
    )
  );
  const showForge = $derived(tab === 'forge' && !!forge.repo);
  const pages = $derived(
    Math.max(1, Math.ceil((showForge ? forgeFiltered : filtered).length / PAGE))
  );
  const current = $derived(Math.min(page, pages));
  const firstLine = (text: string) => text.split('\n')[0] ?? '';
  function select(next: 'nostr' | 'forge') {
    tab = next;
    page = 1;
  }
</script>

{#snippet pager()}
  {#if pages > 1}<nav aria-label="Release pages">
      <button disabled={current === 1} onclick={() => (page = current - 1)}>Previous</button> Page {current}
      of {pages}
      <button disabled={current === pages} onclick={() => (page = current + 1)}>Next</button>
    </nav>{/if}
{/snippet}

<div class="release-list">
  <header>
    <h2>Releases</h2>
    {#if isMaintainer}<button disabled={list.loading || list.stalled} onclick={onCreateRelease}
        >New Release</button
      >{/if}
  </header>
  {#if forge.repo}
    <div class="tabs" role="tablist" aria-label="Release sources">
      <button
        role="tab"
        aria-selected={!showForge}
        class:active={!showForge}
        onclick={() => select('nostr')}>Nostr <span class="count">{list.events.length}</span></button
      >
      <button role="tab" aria-selected={showForge} class:active={showForge} onclick={() => select('forge')}
        >{forgeName} <span class="count">{forge.releases.length}</span>
        <span class="unverified">unverified</span></button
      >
    </div>
  {/if}
  {#if !showForge}
    <p>
      Only applications and releases signed by current repository maintainers are shown; a release
      must name an application they published.
    </p>
    {#if list.stalled}
      <div role="alert" class="notice">
        Relay results are incomplete on every relay{list.error ? `: ${list.error}` : '.'} Nothing is
        known about the release history, so publication is disabled until at least one relay answers.
        <button onclick={onRetry}>Retry discovery</button>
      </div>
    {:else if list.partial || list.error}
      <div role="note" class="notice">
        Some relays did not answer{list.error ? `: ${list.error}` : '.'} Releases known only to them
        are not shown, and a new publication will not reach them.
        <button onclick={onRetry}>Retry discovery</button>
      </div>
    {/if}
    {#if list.loading}<p role="status">Loading releases…</p>{/if}
    {#if list.events.length}
      <div class="filters">
        <input
          type="search"
          aria-label="Filter version"
          placeholder="Filter version…"
          bind:value={version}
          oninput={() => (page = 1)}
        />
        <select aria-label="Filter platform" bind:value={platform} onchange={() => (page = 1)}
          ><option value="all">All platforms</option>{#each platforms as p}<option value={p}
              >{platformLabel([p])}</option
            >{/each}</select
        >
        <select aria-label="Filter date" bind:value={days} onchange={() => (page = 1)}
          ><option value="all">Any time</option><option value="30">Last 30 days</option><option
            value="90">Last 90 days</option
          ><option value="365">Last year</option></select
        >
      </div>
      <ul>
        {#each filtered.slice((current - 1) * PAGE, current * PAGE) as event (event.id)}
          {@const item = parseReleaseListItem(event)}
          <li>
            <button class="release-card" onclick={() => onViewRelease(event)}>
              <strong>{item.version}</strong>
              <span>{item.channel} · {formatDate(item.createdAt)} · {item.assetCount} assets</span>
              <span>{item.appId}</span><span title={item.pubkey}
                >Publisher: {item.pubkey.slice(0, 16)}…</span
              >
              <span>{firstLine(event.content)}</span>
            </button>
          </li>
        {/each}
      </ul>
      {#if !filtered.length}<p>No matching releases.</p>{/if}
      {@render pager()}
    {:else if !list.loading && !list.stalled}<p>
        No authorized releases found for this repository.
      </p>{/if}
  {:else if forge.repo}
    <p>
      Listed from
      <a href={forge.repo.webUrl} target="_blank" rel="noopener noreferrer"
        >{forge.repo.owner}/{forge.repo.name}</a
      >
      without authentication. These are not Nostr-signed and are not part of the signed release
      history; a maintainer can import one to publish it as a signed release.
      <button onclick={onRefreshForge} disabled={forge.loading}>Refresh</button>
    </p>
    {#if forge.loading}<p role="status">Loading {forgeName} releases…</p>{/if}
    {#if forge.error}<p class="issue">{forge.error}</p>{/if}
    {#if forge.releases.length}
      <div class="filters">
        <input
          type="search"
          aria-label="Filter version"
          placeholder="Filter version…"
          bind:value={version}
          oninput={() => (page = 1)}
        />
        <select aria-label="Filter date" bind:value={days} onchange={() => (page = 1)}
          ><option value="all">Any time</option><option value="30">Last 30 days</option><option
            value="90">Last 90 days</option
          ><option value="365">Last year</option></select
        >
      </div>
      <ul>
        {#each forgeFiltered.slice((current - 1) * PAGE, current * PAGE) as release (release.id)}
          <li>
            <div class="release-card forge-card">
              <strong>{release.tag}</strong>
              <span
                >{release.prerelease ? 'pre-release' : 'release'} · {release.publishedAt
                  ? formatDate(release.publishedAt)
                  : 'unpublished'} · {release.assets.length} assets</span
              >
              <span>{release.name}</span>
              <span>Publisher: {forge.repo.owner}/{forge.repo.name} on {forgeName}</span>
              <span>{firstLine(release.notes)}</span>
              <div class="actions">
                {#if release.url}<a href={release.url} target="_blank" rel="noopener noreferrer"
                    >View on {forgeName}</a
                  >{/if}
                {#if isMaintainer}<button onclick={() => onImport(release)}
                    >Import as Nostr release</button
                  >{/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
      {#if !forgeFiltered.length}<p>No matching releases.</p>{/if}
      {@render pager()}
    {:else if !forge.loading && !forge.error}<p>No releases found on {forgeName}.</p>{/if}
  {/if}
</div>

<style>
  .release-list {
    padding: 1.25rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 1.1rem;
  }
  p,
  span {
    color: var(--ext-text-secondary);
    font-size: 0.85rem;
  }
  button,
  input,
  select {
    padding: 0.45rem 0.75rem;
    border: 1px solid var(--ext-border);
    border-radius: 6px;
    background: var(--ext-surface);
    color: var(--ext-text);
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin: 0.75rem 0;
    border-bottom: 1px solid var(--ext-border);
  }
  [role='tab'] {
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--ext-text-secondary);
    margin-bottom: -1px;
  }
  [role='tab'].active {
    border-color: var(--ext-border);
    background: var(--ext-surface);
    color: var(--ext-text);
  }
  .count {
    color: var(--ext-text-muted);
  }
  .unverified {
    font-size: 0.75rem;
    color: var(--ext-warning-text);
    background: var(--ext-warning-bg);
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    margin-left: 0.25rem;
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  ul {
    padding: 0;
    list-style: none;
  }
  li {
    margin: 0.5rem 0;
  }
  .release-card {
    display: block;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    padding: 1rem;
  }
  .release-card:hover {
    border-color: var(--ext-accent);
  }
  .release-card span {
    display: block;
    margin-top: 0.2rem;
    overflow-wrap: anywhere;
  }
  .forge-card {
    border: 1px solid var(--ext-border);
    border-radius: 6px;
    background: var(--ext-surface);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }
  .actions a {
    color: var(--ext-accent);
  }
  strong {
    color: var(--ext-accent);
  }
  .issue {
    color: var(--ext-danger-text);
  }
  .notice {
    padding: 0.75rem;
    background: var(--ext-warning-bg);
    color: var(--ext-warning-text);
    border-radius: 6px;
  }
  nav {
    text-align: center;
  }
</style>
