import { describe, expect, it, vi } from 'vitest';
import {
  fetchForgeReleases,
  forgeArtifacts,
  forgeReleasesUrl,
  forgeRepoFromUrls,
  parseForgeUrl,
  versionFromTag,
  type ForgeRepo,
} from './forge.js';

const DIGEST = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const github: ForgeRepo = { kind: 'github', host: 'github.com', owner: 'o', name: 'r', webUrl: 'https://github.com/o/r' };
const respond = (handler: (url: string) => { status?: number; url?: string; body: unknown }) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('omit');
    const { status = 200, url: finalUrl = url, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      url: finalUrl,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;

describe('forge repositories', () => {
  it('parses clone and web URLs of known forges', () => {
    expect(parseForgeUrl('https://github.com/greenart7c3/Amber.git')).toMatchObject({ kind: 'github', owner: 'greenart7c3', name: 'Amber' });
    expect(parseForgeUrl('git@github.com:o/r.git')).toMatchObject({ kind: 'github', host: 'github.com', owner: 'o', name: 'r' });
    expect(parseForgeUrl('https://github.com/o/r/releases/tag/v1')).toMatchObject({ owner: 'o', name: 'r' });
    expect(parseForgeUrl('https://gitlab.com/group/sub/proj/-/releases')).toMatchObject({ kind: 'gitlab', owner: 'group/sub', name: 'proj' });
    expect(parseForgeUrl('https://codeberg.org/o/r')).toMatchObject({ kind: 'gitea' });
    expect(parseForgeUrl('https://git.example.org/o/r.git')).toMatchObject({ kind: undefined, host: 'git.example.org' });
    expect(parseForgeUrl('https://relay.ngit.dev/npub1abc/Amber.git')).toMatchObject({ kind: undefined, owner: 'npub1abc' });
    expect(parseForgeUrl('ftp://github.com/o/r')).toBeUndefined();
    expect(parseForgeUrl('https://github.com/o')).toBeUndefined();
    expect(parseForgeUrl('not a url')).toBeUndefined();
  });
  it('prefers a known forge over a self-hosted guess', () => {
    expect(forgeRepoFromUrls(['https://relay.ngit.dev/npub1abc/Amber.git', 'https://github.com/o/r'])?.kind).toBe('github');
    expect(forgeRepoFromUrls(['https://git.example.org/o/r'])?.host).toBe('git.example.org');
    expect(forgeRepoFromUrls([])).toBeUndefined();
  });
  it('builds API URLs per forge', () => {
    expect(forgeReleasesUrl(github, 'github')).toBe('https://api.github.com/repos/o/r/releases?per_page=30');
    expect(forgeReleasesUrl({ ...github, host: 'gitlab.com', owner: 'g/s' }, 'gitlab')).toBe('https://gitlab.com/api/v4/projects/g%2Fs%2Fr/releases?per_page=30');
    expect(forgeReleasesUrl({ ...github, host: 'codeberg.org' }, 'gitea')).toBe('https://codeberg.org/api/v1/repos/o/r/releases?limit=30');
  });
  it('strips a leading v from tags', () => {
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('version-1')).toBe('version-1');
  });
});

describe('forge releases', () => {
  it('maps GitHub releases, skips drafts, keeps published checksums and sorts newest first', async () => {
    const fetch = respond(() => ({
      body: [
        { id: 1, tag_name: 'v1.0.0', name: 'One', body: 'first', html_url: 'https://github.com/o/r/releases/tag/v1.0.0', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: [{ name: 'app-1.0.0-linux-x86_64.AppImage', size: 4, content_type: 'application/octet-stream', browser_download_url: 'https://github.com/o/r/releases/download/v1.0.0/app.AppImage', digest: `sha256:${DIGEST}` }] },
        { id: 2, tag_name: 'v2.0.0', name: 'Two', body: '', html_url: 'https://github.com/o/r/releases/tag/v2.0.0', draft: false, prerelease: true, published_at: '2026-02-01T00:00:00Z', assets: [{ name: 'x.bin', browser_download_url: 'http://insecure.example/x.bin' }] },
        { id: 3, tag_name: 'v3.0.0', draft: true, assets: [] },
      ],
    }));
    const { kind, releases } = await fetchForgeReleases(github, { fetch });
    expect(kind).toBe('github');
    expect(releases.map((r) => r.tag)).toEqual(['v2.0.0', 'v1.0.0']);
    expect(releases[1]).toMatchObject({ id: '1', name: 'One', notes: 'first', prerelease: false, publishedAt: Date.UTC(2026, 0, 1) / 1000 });
    expect(releases[1]?.assets[0]).toMatchObject({ name: 'app-1.0.0-linux-x86_64.AppImage', size: 4, sha256: DIGEST });
    // Insecure download URLs are dropped.
    expect(releases[0]?.assets).toEqual([]);
  });
  it('maps GitLab release links and Gitea releases, probing unknown hosts', async () => {
    const gitlab = respond(() => ({
      body: [{ tag_name: 'v1.1', name: 'GL', description: 'notes', released_at: '2026-03-01T00:00:00Z', _links: { self: 'https://gitlab.com/g/p/-/releases/v1.1' }, assets: { sources: [{ format: 'zip', url: 'https://gitlab.com/g/p/-/archive/v1.1/p-v1.1.zip' }], links: [{ name: 'p-linux-x86_64', url: 'https://gitlab.com/g/p/-/releases/v1.1/downloads/p-linux-x86_64', link_type: 'package' }] } }],
    }));
    const gl = await fetchForgeReleases({ ...github, kind: 'gitlab', host: 'gitlab.com', owner: 'g', name: 'p' }, { fetch: gitlab });
    expect(gl.releases[0]).toMatchObject({ tag: 'v1.1', name: 'GL', notes: 'notes', url: 'https://gitlab.com/g/p/-/releases/v1.1' });
    expect(gl.releases[0]?.assets.map((a) => a.name)).toEqual(['p-linux-x86_64']);
    const selfHosted = respond((url) =>
      url.includes('/api/v1/') ? { status: 404, body: 'not found' } : { body: [{ tag_name: 'v9', name: 'Nine', assets: { links: [] } }] }
    );
    const probed = await fetchForgeReleases({ ...github, kind: undefined, host: 'git.example.org' }, { fetch: selfHosted });
    expect(probed.kind).toBe('gitlab');
    expect(probed.releases[0]?.tag).toBe('v9');
    expect(selfHosted).toHaveBeenCalledTimes(2);
  });
  it('rejects redirects to other hosts, non-array bodies and oversized responses', async () => {
    await expect(fetchForgeReleases(github, { fetch: respond((url) => ({ url: url.replace('api.github.com', 'evil.example'), body: [] })) })).rejects.toThrow('another host');
    await expect(fetchForgeReleases(github, { fetch: respond(() => ({ body: { message: 'rate limited' } })) })).rejects.toThrow('unexpected shape');
    await expect(fetchForgeReleases(github, { fetch: respond(() => ({ body: '['.padEnd(5 * 1024 * 1024, ' ') })) })).rejects.toThrow('too large');
    await expect(fetchForgeReleases(github, { fetch: respond(() => ({ status: 403, body: '' })) })).rejects.toThrow('403');
  });
  it('turns forge assets into artifacts with NIP-82 classification', () => {
    const artifacts = forgeArtifacts(github, 'github', {
      id: '1', tag: 'v1.0.0', name: 'One', notes: '', url: '', prerelease: false,
      assets: [
        { name: 'app-1.0.0-linux-x86_64.AppImage', url: 'https://github.com/o/r/releases/download/v1.0.0/a.AppImage', size: 4, mimeType: 'application/octet-stream', sha256: DIGEST },
        { name: 'app-1.0.0-darwin-arm64.dmg', url: 'https://github.com/o/r/releases/download/v1.0.0/a.dmg' },
      ],
    });
    expect(artifacts[0]).toMatchObject({ eventId: 'forge:github:1:0', sha256: DIGEST, mimeType: 'application/vnd.appimage', platforms: ['linux-x86_64'], checksumFrom: 'GitHub', forgeRelease: 'github:github.com/o/r#1' });
    expect(artifacts[1]).toMatchObject({ sha256: '', mimeType: 'application/x-apple-diskimage', platforms: ['darwin-arm64'], checksumFrom: undefined });
  });
});
