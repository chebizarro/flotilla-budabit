// NIP-82 asset classification: Appendix A platform identifiers and Appendix C
// MIME types. CI artifacts (kind 1063) usually arrive as
// `application/octet-stream` with no platform metadata, so the widget infers
// NIP-82 values from the filename and lets the maintainer confirm them. The
// same rules apply to mobile and non-mobile (desktop, CLI, extension) assets.
import { HEX_KEY } from './context.js';
import { safeAssetUrl } from './binary.js';
import { PLATFORMS, type Artifact } from './types.js';

export type PlatformOs = 'android' | 'ios' | 'darwin' | 'linux' | 'windows' | 'freebsd' | 'wasm' | 'wasi';

export interface Nip82MimeType {
  /** Lower-case filename extensions that imply this MIME type. */
  extensions: string[];
  /** Operating systems the MIME type can target; undefined = runtime-implied (any OS). */
  os?: PlatformOs[];
  /** True when the MIME type alone does not determine the target platform (Appendix C). */
  requiresPlatform: boolean;
}

/** NIP-82 Appendix C. Generic archives and dependency-based packages are intentionally absent. */
export const NIP82_MIME_TYPES: Record<string, Nip82MimeType> = {
  'application/vnd.android.package-archive': { extensions: ['apk'], os: ['android'], requiresPlatform: false },
  'application/vnd.apple.ipa': { extensions: ['ipa'], os: ['ios'], requiresPlatform: false },
  'application/x-apple-diskimage': { extensions: ['dmg'], os: ['darwin'], requiresPlatform: false },
  'application/vnd.apple.installer+xml': { extensions: ['pkg'], os: ['darwin'], requiresPlatform: false },
  'application/x-msi': { extensions: ['msi'], os: ['windows'], requiresPlatform: false },
  'application/vnd.appimage': { extensions: ['appimage'], os: ['linux'], requiresPlatform: false },
  'application/vnd.flatpak': { extensions: ['flatpak'], os: ['linux'], requiresPlatform: false },
  'application/vnd.oci.image.manifest.v1+json': { extensions: [], requiresPlatform: false },
  'application/x-executable': { extensions: [], os: ['linux', 'freebsd'], requiresPlatform: true },
  'application/x-mach-binary': { extensions: [], os: ['darwin', 'ios'], requiresPlatform: true },
  'application/vnd.microsoft.portable-executable': { extensions: ['exe'], os: ['windows'], requiresPlatform: true },
  'application/vsix': { extensions: ['vsix'], requiresPlatform: false },
  'application/x-chrome-extension': { extensions: ['crx'], requiresPlatform: false },
  'application/x-xpinstall': { extensions: ['xpi'], requiresPlatform: false },
  'application/wasm': { extensions: ['wasm'], os: ['wasm', 'wasi'], requiresPlatform: false },
  'application/webbundle': { extensions: ['wbn', 'swbn'], requiresPlatform: false },
};

/** File types NIP-82 explicitly excludes; publishing them would never render in a store. */
export const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  zip: 'generic archive',
  tar: 'generic archive',
  gz: 'generic archive',
  tgz: 'generic archive',
  xz: 'generic archive',
  bz2: 'generic archive',
  '7z': 'generic archive',
  rar: 'generic archive',
  deb: 'dependency-based package',
  rpm: 'dependency-based package',
  snap: 'dependency-based package',
};

const OS_TOKENS: Record<string, PlatformOs> = {
  android: 'android',
  ios: 'ios',
  darwin: 'darwin',
  macos: 'darwin',
  mac: 'darwin',
  osx: 'darwin',
  apple: 'darwin',
  linux: 'linux',
  windows: 'windows',
  win: 'windows',
  win32: 'windows',
  win64: 'windows',
  freebsd: 'freebsd',
  wasi: 'wasi',
  wasm: 'wasm',
};

/** Architecture tokens → per-OS Appendix A architecture suffix. */
const ARCH_TOKENS: Record<string, Partial<Record<PlatformOs, string>>> = {
  arm64: { android: 'arm64-v8a', darwin: 'arm64', ios: 'arm64', linux: 'aarch64', windows: 'aarch64', freebsd: 'aarch64' },
  aarch64: { android: 'arm64-v8a', darwin: 'arm64', ios: 'arm64', linux: 'aarch64', windows: 'aarch64', freebsd: 'aarch64' },
  'arm64-v8a': { android: 'arm64-v8a' },
  x86_64: { android: 'x86_64', darwin: 'x86_64', linux: 'x86_64', windows: 'x86_64', freebsd: 'x86_64' },
  amd64: { android: 'x86_64', darwin: 'x86_64', linux: 'x86_64', windows: 'x86_64', freebsd: 'x86_64' },
  x64: { darwin: 'x86_64', linux: 'x86_64', windows: 'x86_64', freebsd: 'x86_64' },
  x86: { android: 'x86' },
  i386: { android: 'x86' },
  i686: { android: 'x86' },
  armv7: { android: 'armeabi-v7a', linux: 'armv7l' },
  armv7l: { linux: 'armv7l' },
  'armeabi-v7a': { android: 'armeabi-v7a' },
  riscv64: { linux: 'riscv64' },
  wasm32: { wasm: '32', wasi: 'wasm32' },
  wasm64: { wasm: '64', wasi: 'wasm64' },
};

export function fileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? '';
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
}

export function isNip82MimeType(mimeType: string | undefined): boolean {
  return !!mimeType && Object.prototype.hasOwnProperty.call(NIP82_MIME_TYPES, mimeType);
}

/** Appendix C MIME type implied by a filename, if any. */
export function mimeTypeFromFilename(filename: string): string | undefined {
  const extension = fileExtension(filename);
  if (!extension) return undefined;
  return Object.keys(NIP82_MIME_TYPES).find((mime) =>
    NIP82_MIME_TYPES[mime]?.extensions.includes(extension)
  );
}

/** Operating system of an Appendix A identifier, or undefined for unknown identifiers. */
export function platformOs(platform: string): PlatformOs | undefined {
  if (!(PLATFORMS as readonly string[]).includes(platform)) return undefined;
  if (platform === 'wasm32' || platform === 'wasm64') return 'wasm';
  return platform.split('-')[0] as PlatformOs;
}

function joinPlatform(os: PlatformOs, arch: string): string {
  return os === 'wasm' ? `wasm${arch}` : `${os}-${arch}`;
}

/**
 * Appendix A identifiers suggested by filename tokens such as
 * `app-1.2.0-darwin-arm64.dmg` or `tool_linux_amd64`, restricted to the OS
 * family implied by the MIME type when one is known. Never guesses when the
 * filename carries no architecture: an omitted `f` tag legitimately means
 * "every architecture of the implied platform".
 */
export function platformsFromFilename(filename: string, mimeType?: string): string[] {
  const tokens = (filename.split(/[/\\]/).pop() ?? '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const allowedOs = (mimeType && NIP82_MIME_TYPES[mimeType]?.os) || undefined;
  const namedOs = tokens.map((t) => OS_TOKENS[t]).filter((os): os is PlatformOs => !!os);
  const candidates = namedOs.filter((os) => !allowedOs || allowedOs.includes(os));
  // Without an OS token, fall back to the MIME type's OS family; WASI is only
  // ever chosen when the filename names it, as plain `.wasm` targets browsers.
  const osList = candidates.length ? candidates : (allowedOs ?? []).filter((os) => os !== 'wasi');
  const found = new Set<string>();
  for (const token of tokens) {
    const arch = ARCH_TOKENS[token];
    if (!arch) continue;
    for (const os of osList) {
      const suffix = arch[os];
      if (!suffix) continue;
      const id = joinPlatform(os, suffix);
      if ((PLATFORMS as readonly string[]).includes(id)) found.add(id);
    }
  }
  return [...found];
}

export interface AssetClassification {
  mimeType: string;
  platforms: string[];
  /** True when the MIME type was inferred from the filename rather than declared. */
  inferredMimeType: boolean;
  inferredPlatforms: boolean;
}

/**
 * Fill NIP-82 metadata a CI artifact did not declare. A declared Appendix C
 * MIME type always wins; an unclassified one (typically octet-stream from a
 * generic uploader) is replaced by the filename's implied type when known.
 */
export function classifyArtifact(artifact: {
  filename: string;
  mimeType?: string;
  platforms?: string[];
}): AssetClassification {
  const declared = artifact.mimeType?.trim() || '';
  const fromName = mimeTypeFromFilename(artifact.filename);
  const mimeType = isNip82MimeType(declared)
    ? declared
    : (fromName ?? declared);
  const declaredPlatforms = (artifact.platforms ?? []).filter(Boolean);
  const platforms = declaredPlatforms.length
    ? declaredPlatforms
    : platformsFromFilename(artifact.filename, mimeType);
  return {
    mimeType: mimeType || 'application/octet-stream',
    platforms,
    inferredMimeType: mimeType !== declared,
    inferredPlatforms: !declaredPlatforms.length && platforms.length > 0,
  };
}

export interface AssetIssues {
  /** Publication is refused while any error remains. */
  errors: string[];
  /** Publication proceeds, but the asset may not render in a store. */
  warnings: string[];
}

/** NIP-82 conformance of one asset as it would be signed. */
export function assetIssues(artifact: Artifact): AssetIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mimeType = artifact.mimeType.trim();
  const platforms = [...new Set((artifact.platforms ?? []).filter(Boolean))];
  if (!HEX_KEY.test(artifact.sha256) || !safeAssetUrl(artifact.url))
    errors.push('Asset needs a valid SHA-256 and HTTPS URL');
  if (!mimeType.includes('/')) errors.push('Asset needs a MIME type');
  if (artifact.size !== undefined && (!Number.isSafeInteger(artifact.size) || artifact.size < 0))
    errors.push('Invalid asset size');
  const extension = fileExtension(artifact.filename);
  const unsupported = UNSUPPORTED_EXTENSIONS[extension];
  if (unsupported && !isNip82MimeType(mimeType))
    errors.push(
      `.${extension} is a ${unsupported}; NIP-82 assets must be installable or executable on their own (see Appendix C)`
    );
  const spec = NIP82_MIME_TYPES[mimeType];
  for (const platform of platforms) {
    if (!platformOs(platform)) errors.push(`Unknown platform identifier "${platform}" (NIP-82 Appendix A)`);
  }
  if (spec) {
    if (spec.requiresPlatform && platforms.length === 0)
      errors.push(`${mimeType} does not determine the target platform; add at least one platform (f) tag`);
    if (spec.os) {
      for (const platform of platforms) {
        const os = platformOs(platform);
        if (os && !spec.os.includes(os))
          errors.push(`Platform "${platform}" does not match ${mimeType} (${spec.os.join('/')})`);
      }
    }
  } else if (mimeType.includes('/')) {
    warnings.push(
      `${mimeType} is not a NIP-82 Appendix C MIME type; stores such as zapstore will not classify this asset`
    );
  }
  if (mimeType === 'application/vnd.android.package-archive') {
    if (
      !Number.isSafeInteger(artifact.versionCode) ||
      (artifact.versionCode ?? -1) < 0 ||
      !artifact.apkCertificateHashes?.length ||
      artifact.apkCertificateHashes.some((h) => !HEX_KEY.test(h))
    )
      errors.push('APK requires version_code and apk_certificate_hash metadata');
  }
  return { errors, warnings };
}

/** Union of asset platforms for the application's `f` tags (Appendix A). */
export function unionPlatforms(...lists: Array<string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []).filter((p) => !!platformOs(p)))];
}
