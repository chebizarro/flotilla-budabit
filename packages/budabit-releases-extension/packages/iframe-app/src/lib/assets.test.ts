import { describe, expect, it } from 'vitest';
import {
  NIP82_MIME_TYPES,
  assetIssues,
  classifyArtifact,
  fileExtension,
  mimeTypeFromFilename,
  platformOs,
  platformsFromFilename,
  unionPlatforms,
} from './assets.js';
import { MIME_TYPES, PLATFORMS, type Artifact } from './types.js';

const base = (overrides: Partial<Artifact> = {}): Artifact => ({
  eventId: 'asset',
  sha256: 'a'.repeat(64),
  url: 'https://files.example/download',
  filename: 'tool',
  mimeType: 'application/octet-stream',
  ...overrides,
});

describe('NIP-82 asset classification', () => {
  it('covers exactly the Appendix C MIME types the UI already labels', () => {
    expect(Object.keys(NIP82_MIME_TYPES).sort()).toEqual(Object.keys(MIME_TYPES).sort());
    for (const [mime, spec] of Object.entries(NIP82_MIME_TYPES))
      for (const extension of spec.extensions)
        expect(mimeTypeFromFilename(`app-1.0.${extension}`)).toBe(mime);
  });

  it('classifies every Appendix A identifier by operating system', () => {
    for (const platform of PLATFORMS) expect(platformOs(platform)).toBeDefined();
    expect(platformOs('wasm32')).toBe('wasm');
    expect(platformOs('wasi-wasm64')).toBe('wasi');
    expect(platformOs('plan9-mips')).toBeUndefined();
    expect(fileExtension('dir/App.Image.AppImage')).toBe('appimage');
    expect(fileExtension('README')).toBe('');
  });

  it('infers desktop, mobile and CLI platforms from filename tokens', () => {
    expect(platformsFromFilename('app-1.2.0-darwin-arm64.dmg', 'application/x-apple-diskimage')).toEqual(['darwin-arm64']);
    expect(platformsFromFilename('tool_linux_amd64', 'application/x-executable')).toEqual(['linux-x86_64']);
    expect(platformsFromFilename('tool-windows-x64.exe')).toEqual(['windows-x86_64']);
    expect(platformsFromFilename('app-arm64-v8a-release.apk', 'application/vnd.android.package-archive')).toEqual(['android-arm64-v8a']);
    // Architecture alone: restricted to the MIME type's OS family, never guessed across families.
    expect(platformsFromFilename('app-arm64.dmg', 'application/x-apple-diskimage')).toEqual(['darwin-arm64']);
    expect(platformsFromFilename('tool-aarch64', 'application/x-executable').sort()).toEqual(['freebsd-aarch64', 'linux-aarch64']);
    // Conflicting OS token is dropped rather than mislabelling a macOS image as Linux.
    expect(platformsFromFilename('app-linux-x86_64.dmg', 'application/x-apple-diskimage')).toEqual([]);
    // Universal builds omit `f`.
    expect(platformsFromFilename('app-universal.dmg', 'application/x-apple-diskimage')).toEqual([]);
    expect(platformsFromFilename('module-wasm32.wasm', 'application/wasm')).toEqual(['wasm32']);
  });

  it('replaces generic CI MIME types with the filename type but keeps declared Appendix C types', () => {
    expect(classifyArtifact({ filename: 'app.apk', mimeType: 'application/octet-stream' })).toMatchObject({
      mimeType: 'application/vnd.android.package-archive',
      inferredMimeType: true,
      platforms: [],
    });
    expect(classifyArtifact({ filename: 'app.dmg', mimeType: 'application/x-mach-binary' })).toMatchObject({
      mimeType: 'application/x-mach-binary',
      inferredMimeType: false,
    });
    expect(classifyArtifact({ filename: 'tool-linux-x86_64', mimeType: undefined })).toMatchObject({
      mimeType: 'application/octet-stream',
      platforms: [],
    });
    expect(
      classifyArtifact({ filename: 'app-linux-x86_64.AppImage', mimeType: '', platforms: ['linux-aarch64'] })
    ).toMatchObject({ platforms: ['linux-aarch64'], inferredPlatforms: false });
  });

  it('rejects archives, dependency packages and unresolved native binaries', () => {
    expect(assetIssues(base({ filename: 'release.zip', mimeType: 'application/zip' })).errors[0]).toContain('generic archive');
    expect(assetIssues(base({ filename: 'tool.deb' })).errors[0]).toContain('dependency-based package');
    expect(
      assetIssues(base({ filename: 'tool', mimeType: 'application/x-executable' })).errors[0]
    ).toContain('platform');
    expect(
      assetIssues(base({ filename: 'tool', mimeType: 'application/x-executable', platforms: ['linux-x86_64'] }))
    ).toEqual({ errors: [], warnings: [] });
    expect(
      assetIssues(base({ filename: 'app.dmg', mimeType: 'application/x-apple-diskimage', platforms: ['linux-x86_64'] })).errors[0]
    ).toContain('does not match');
    expect(assetIssues(base({ platforms: ['amiga-68k'] })).errors[0]).toContain('Unknown platform');
    expect(assetIssues(base({ mimeType: 'application/vnd.android.package-archive' })).errors[0]).toContain('APK');
  });

  it('warns, but does not block, unclassified binaries and reports base metadata errors', () => {
    const generic = assetIssues(base());
    expect(generic.errors).toEqual([]);
    expect(generic.warnings[0]).toContain('zapstore');
    expect(assetIssues(base({ url: 'http://insecure.example/x' })).errors[0]).toContain('HTTPS');
    expect(assetIssues(base({ mimeType: 'bad' })).errors[0]).toContain('MIME');
    expect(assetIssues(base({ size: -1 })).errors[0]).toContain('size');
    expect(unionPlatforms(['linux-x86_64'], undefined, ['linux-x86_64', 'darwin-arm64', 'bogus'])).toEqual([
      'linux-x86_64',
      'darwin-arm64',
    ]);
  });
});
