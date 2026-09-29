import { sha256 } from '@noble/hashes/sha2.js';
import { HEX_KEY } from './context.js';

export const MAX_BINARY_BYTES = 512 * 1024 * 1024;
export function safeAssetUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Incremental hashing keeps memory bounded. Never executes or uploads the file. */
export async function hashBlob(file: Blob): Promise<{ sha256: string; size: number }> {
  if (file.size > MAX_BINARY_BYTES) throw new Error('File exceeds the 512 MiB hashing limit');
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    hash.update(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
  }
  return { sha256: hex(hash.digest()), size: file.size };
}

/**
 * SHA-256 of the bytes served at an HTTPS URL, streamed and bounded. This is
 * the only download the widget performs itself; the forge must allow
 * cross-origin reads, which GitHub release assets do.
 */
export async function hashRemote(
  url: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {}
): Promise<{ sha256: string; size: number }> {
  const safe = safeAssetUrl(url);
  if (!safe) throw new Error('Asset URL must be HTTPS');
  const response = await (options.fetch ?? globalThis.fetch)(safe, {
    method: 'GET',
    credentials: 'omit',
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Download answered ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BINARY_BYTES) throw new Error('Download exceeds the 512 MiB hashing limit');
  const hash = sha256.create();
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BINARY_BYTES) throw new Error('Download exceeds the 512 MiB hashing limit');
    hash.update(bytes);
    return { sha256: hex(hash.digest()), size: bytes.length };
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BINARY_BYTES) {
      await reader.cancel();
      throw new Error('Download exceeds the 512 MiB hashing limit');
    }
    hash.update(value);
  }
  return { sha256: hex(hash.digest()), size };
}

export async function verifyBinary(
  file: Blob,
  expectedHash: string,
  expectedSize?: number
): Promise<void> {
  if (!HEX_KEY.test(expectedHash)) throw new Error('Invalid SHA-256');
  if (file.size > MAX_BINARY_BYTES) throw new Error('File exceeds the 512 MiB verification limit');
  if (expectedSize !== undefined && file.size !== expectedSize)
    throw new Error('File size does not match signed metadata');
  const { sha256: actual } = await hashBlob(file);
  if (actual !== expectedHash) throw new Error('SHA-256 mismatch: do not use this file');
}
