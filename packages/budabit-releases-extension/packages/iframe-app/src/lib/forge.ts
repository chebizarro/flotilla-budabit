// Forge (GitHub / GitLab / Gitea) releases. The only HTTP the widget performs:
// read-only, unauthenticated HTTPS GETs to the forge named by the repository's
// own clone/web URL. Public repositories only; no tokens are held or sent.
// Forge releases never enter Nostr authority: they are shown as unverified and
// can be imported, after which the maintainer signs the resulting NIP-82 events.
import { record } from './context.js';
import { classifyArtifact } from './assets.js';
import { safeAssetUrl } from './binary.js';
import type { Artifact } from './types.js';

export type ForgeKind = 'github' | 'gitlab' | 'gitea';
export interface ForgeRepo {
  /** Undefined for a self-hosted forge of unknown type; the Gitea then GitLab APIs are tried. */
  kind?: ForgeKind;
  host: string;
  owner: string;
  name: string;
  webUrl: string;
}
export interface ForgeAsset {
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
  /** Checksum published by the forge (GitHub asset `digest`), lower-case hex. */
  sha256?: string;
}
export interface ForgeRelease {
  id: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt?: number;
  prerelease: boolean;
  assets: ForgeAsset[];
}

/** Forge listing shown under the Nostr release list. */
export interface ForgeState {
  repo?: ForgeRepo;
  kind?: ForgeKind;
  releases: ForgeRelease[];
  loading: boolean;
  error: string;
}
/** A forge release handed to the release form for import. */
export interface ForgeImport {
  repo: ForgeRepo;
  kind: ForgeKind;
  release: ForgeRelease;
}

export const FORGE_LABELS: Record<ForgeKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
};
const KNOWN_HOSTS: Record<string, ForgeKind> = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'codeberg.org': 'gitea',
  'gitea.com': 'gitea',
};
export const MAX_FORGE_RELEASES = 30;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Repository named by `https://host/owner/name(.git)`, `git@host:owner/name.git`
 * or `ssh://git@host/owner/name`. GitLab paths may carry subgroups; a trailing
 * `/-/…` route segment is ignored.
 */
export function parseForgeUrl(value: string, kind?: ForgeKind): ForgeRepo | undefined {
  const text = value.trim();
  let host = '';
  let path = '';
  const ssh = /^(?:ssh:\/\/)?git@([a-z0-9.-]+)[:/](.+)$/i.exec(text);
  if (ssh) {
    host = (ssh[1] ?? '').toLowerCase();
    path = ssh[2] ?? '';
  } else {
    try {
      const url = new URL(text);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
      host = url.hostname.toLowerCase();
      path = url.pathname;
    } catch {
      return undefined;
    }
  }
  const resolved = kind ?? KNOWN_HOSTS[host];
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  const route = parts.indexOf('-');
  const segments = (route >= 0 ? parts.slice(0, route) : parts).filter(Boolean);
  if (segments.length < 2 || !/^[a-z0-9.-]+$/i.test(host)) return undefined;
  const scoped = resolved === 'gitlab' ? segments : segments.slice(0, 2);
  const name = (scoped[scoped.length - 1] ?? '').replace(/\.git$/i, '');
  const owner = scoped.slice(0, -1).join('/');
  if (!name || !owner || /[^a-z0-9._/-]/i.test(owner) || /[^a-z0-9._-]/i.test(name))
    return undefined;
  return { kind: resolved, host, owner, name, webUrl: `https://${host}/${owner}/${name}` };
}

/** First recognisable forge among a repository's clone/web URLs; known hosts win over self-hosted guesses. */
export function forgeRepoFromUrls(urls: readonly string[]): ForgeRepo | undefined {
  const candidates = urls.map((u) => parseForgeUrl(u)).filter((r): r is ForgeRepo => !!r);
  return candidates.find((r) => r.kind) ?? candidates[0];
}

export function forgeLabel(repo: ForgeRepo): string {
  return repo.kind ? FORGE_LABELS[repo.kind] : repo.host;
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('Forge request timed out'));
  }, FETCH_TIMEOUT_MS);
  const onAbort = () => {
    controller.abort(signal?.reason);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (new URL(response.url || url).hostname !== new URL(url).hostname)
      throw new Error('Forge redirected to another host');
    if (!response.ok) throw new Error(`Forge answered ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('Forge response too large');
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const when = (value: unknown): number | undefined => {
  const ms = Date.parse(str(value));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
};
const digest = (value: unknown): string | undefined => {
  const hex = str(value).replace(/^sha256:/i, '').toLowerCase();
  return SHA256_HEX.test(hex) ? hex : undefined;
};

function asset(entry: Record<string, unknown>, url: unknown): ForgeAsset | undefined {
  const href = safeAssetUrl(url);
  const name = str(entry.name).trim();
  if (!href || !name) return undefined;
  return {
    name,
    url: href,
    size: num(entry.size),
    mimeType: str(entry.content_type) || undefined,
    sha256: digest(entry.digest),
  };
}

function githubRelease(raw: unknown): ForgeRelease | undefined {
  const r = record(raw);
  if (r.draft === true || !str(r.tag_name)) return undefined;
  return {
    id: String(r.id ?? r.tag_name),
    tag: str(r.tag_name),
    name: str(r.name) || str(r.tag_name),
    notes: str(r.body),
    url: safeAssetUrl(r.html_url) ?? '',
    publishedAt: when(r.published_at),
    prerelease: r.prerelease === true,
    assets: (Array.isArray(r.assets) ? r.assets : [])
      .map((a) => asset(record(a), record(a).browser_download_url))
      .filter((a): a is ForgeAsset => !!a),
  };
}

function giteaRelease(raw: unknown): ForgeRelease | undefined {
  // Gitea's release shape matches GitHub's minus asset checksums and MIME types.
  return githubRelease(raw);
}

function gitlabRelease(raw: unknown): ForgeRelease | undefined {
  const r = record(raw);
  if (!str(r.tag_name)) return undefined;
  const links = record(r.assets).links;
  return {
    id: str(r.tag_name),
    tag: str(r.tag_name),
    name: str(r.name) || str(r.tag_name),
    notes: str(r.description),
    url: safeAssetUrl(record(r._links).self) ?? '',
    publishedAt: when(r.released_at),
    prerelease: r.upcoming_release === true,
    // Source archives are generic archives NIP-82 excludes; only linked assets count.
    assets: (Array.isArray(links) ? links : [])
      .map((l) => asset(record(l), record(l).direct_asset_url ?? record(l).url))
      .filter((a): a is ForgeAsset => !!a),
  };
}

export function forgeReleasesUrl(repo: ForgeRepo, kind: ForgeKind): string {
  const owner = encodeURIComponent(repo.owner).replace(/%2F/gi, '/');
  switch (kind) {
    case 'github':
      return `https://api.github.com/repos/${owner}/${encodeURIComponent(repo.name)}/releases?per_page=${MAX_FORGE_RELEASES}`;
    case 'gitlab':
      return `https://${repo.host}/api/v4/projects/${encodeURIComponent(`${repo.owner}/${repo.name}`)}/releases?per_page=${MAX_FORGE_RELEASES}`;
    case 'gitea':
      return `https://${repo.host}/api/v1/repos/${owner}/${encodeURIComponent(repo.name)}/releases?limit=${MAX_FORGE_RELEASES}`;
  }
}

/** Releases of a public repository, newest first. Self-hosted forges of unknown type try Gitea, then GitLab. */
export async function fetchForgeReleases(
  repo: ForgeRepo,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {}
): Promise<{ kind: ForgeKind; releases: ForgeRelease[] }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const kinds: ForgeKind[] = repo.kind ? [repo.kind] : ['gitea', 'gitlab'];
  let lastError: unknown;
  for (const kind of kinds) {
    try {
      const body = await fetchJson(forgeReleasesUrl(repo, kind), fetchImpl, options.signal);
      if (!Array.isArray(body)) throw new Error('Forge returned an unexpected shape');
      const parse = kind === 'github' ? githubRelease : kind === 'gitlab' ? gitlabRelease : giteaRelease;
      const releases = body
        .map(parse)
        .filter((r): r is ForgeRelease => !!r)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, MAX_FORGE_RELEASES);
      return { kind, releases };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Forge releases unavailable');
}

/** Release version as NIP-82 expects it: the tag without a leading `v`. */
export function versionFromTag(tag: string): string {
  return tag.trim().replace(/^v(?=\d)/i, '');
}

/**
 * A forge release's assets as artifacts for the release form. MIME type and
 * platforms are inferred from filenames (NIP-82 Appendix A/C) exactly as for
 * CI artifacts; a forge-published checksum fills `x`, otherwise the maintainer
 * hashes the download or a local copy before the asset can be selected.
 */
export function forgeArtifacts(repo: ForgeRepo, kind: ForgeKind, release: ForgeRelease): Artifact[] {
  return release.assets.map((entry, index) => {
    const classified = classifyArtifact({ filename: entry.name, mimeType: entry.mimeType });
    return {
      eventId: `forge:${kind}:${release.id}:${index}`,
      url: entry.url,
      sha256: entry.sha256 ?? '',
      filename: entry.name,
      mimeType: classified.mimeType,
      size: entry.size,
      platforms: classified.platforms,
      forgeRelease: `${kind}:${repo.host}/${repo.owner}/${repo.name}#${release.id}`,
      checksumFrom: entry.sha256 ? FORGE_LABELS[kind] : undefined,
    };
  });
}
