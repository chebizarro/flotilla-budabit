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
  let version = $state(''),
    platform = $state('all'),
    days = $state('all'),
    page = $state(1);
  const platforms = $derived([...new Set(list.events.flatMap((e) => tagValues(e, 'f')))].sort());
  const filtered = $derived(
    list.events.filter((e) => {
      const item = parseReleaseListItem(e);
      return (
        item.version.toLowerCase().includes(version.trim().toLowerCase()) &&
        (platform === 'all' || tagValues(e, 'f').includes(platform)) &&
        (days === 'all' || e.created_at >= Date.now() / 1000 - Number(days) * 86400)
      );
    })
  );
  const pages = $derived(Math.max(1, Math.ceil(filtered.length / 20)));
  const current = $derived(Math.min(page, pages));
</script>

<div class="release-list">
  <header>
    <h2>Releases</h2>
    {#if isMaintainer}<button disabled={list.loading || list.stalled} onclick={onCreateRelease}
        >New Release</button
      >{/if}
  </header>
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
      Some relays did not answer{list.error ? `: ${list.error}` : '.'} Releases known only to them are
      not shown, and a new publication will not reach them.
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
      {#each filtered.slice((current - 1) * 20, current * 20) as event (event.id)}
        {@const item = parseReleaseListItem(event)}
        <li>
          <button class="release-card" onclick={() => onViewRelease(event)}>
            <strong>{item.version}</strong>
            <span>{item.channel} · {formatDate(item.createdAt)} · {item.assetCount} assets</span>
            <span>{item.appId}</span><span title={item.pubkey}
              >Publisher: {item.pubkey.slice(0, 16)}…</span
            >
            <span>{event.content.split('\n')[0]}</span>
          </button>
        </li>
      {/each}
    </ul>
    {#if !filtered.length}<p>No matching releases.</p>{/if}
    {#if pages > 1}<nav aria-label="Release pages">
        <button disabled={current === 1} onclick={() => (page = current - 1)}>Previous</button> Page {current}
        of {pages}
        <button disabled={current === pages} onclick={() => (page = current + 1)}>Next</button>
      </nav>{/if}
  {:else if !list.loading && !list.stalled}<p>
      No authorized releases found for this repository.
    </p>{/if}
  {#if forge.repo}
    <section class="forge" aria-label="Forge releases">
      <h3>Releases on {forgeLabel(forge.repo)} <span class="unverified">unverified</span></h3>
      <p>
        Listed from
        <a href={forge.repo.webUrl} target="_blank" rel="noopener noreferrer"
          >{forge.repo.owner}/{forge.repo.name}</a
        >
        without authentication. These are not Nostr-signed and are not part of the release history
        above. A maintainer can import one to publish it as a signed release.
      </p>
      <button onclick={onRefreshForge} disabled={forge.loading}>Refresh</button>
      {#if forge.loading}<p>Loading forge releases…</p>{/if}
      {#if forge.error}<p class="issue">{forge.error}</p>{/if}
      {#if !forge.loading && !forge.error && forge.releases.length === 0}<p>No releases found.</p>{/if}
      {#if forge.releases.length}
        <ul>
          {#each forge.releases as release (release.id)}
            <li class="forge-card">
              <strong>{release.name}</strong>
              <span
                >{release.tag}{release.prerelease ? ' · pre-release' : ''}{release.publishedAt
                  ? ` · ${formatDate(release.publishedAt)}`
                  : ''} · {release.assets.length} assets</span
              >
              {#if release.url}<a href={release.url} target="_blank" rel="noopener noreferrer"
                  >View on {forgeLabel(forge.repo)}</a
                >{/if}
              {#if isMaintainer}<button onclick={() => onImport(release)}
                  >Import as Nostr release</button
                >{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
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
  strong {
    color: var(--ext-accent);
  }
  .forge {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--ext-border);
  }
  .forge h3 {
    margin: 0 0 0.5rem;
  }
  .unverified {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--ext-warning-text);
    background: var(--ext-warning-bg);
    border-radius: 4px;
    padding: 0.1rem 0.4rem;
    vertical-align: middle;
  }
  .forge ul {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0;
  }
  .forge-card {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.75rem;
    align-items: center;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--ext-border);
  }
  .forge-card span {
    color: var(--ext-text-muted);
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
