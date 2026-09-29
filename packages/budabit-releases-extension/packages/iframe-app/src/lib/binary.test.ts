// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MAX_BINARY_BYTES, hashBlob, hashRemote, safeAssetUrl, verifyBinary } from './binary.js';

describe('binary verification', () => {
  it('checks exact bytes and size, rejects mismatch and oversized files', async () => {
    const file = new Blob(['test']);
    const hash = createHash('sha256').update('test').digest('hex');
    await expect(verifyBinary(file, hash, 4)).resolves.toBeUndefined();
    await expect(verifyBinary(file, hash, 5)).rejects.toThrow('size');
    await expect(verifyBinary(file, 'a'.repeat(64))).rejects.toThrow('mismatch');
    await expect(verifyBinary({ size: MAX_BINARY_BYTES + 1 } as Blob, hash)).rejects.toThrow(
      '512 MiB'
    );
    await expect(verifyBinary(file, 'invalid')).rejects.toThrow('Invalid');
  });
  it('allows HTTPS only, never executable schemes or URL credentials', () => {
    expect(safeAssetUrl('https://files.example/file')).toBe('https://files.example/file');
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,evil',
      'http://files.example',
      'https://user:pass@files.example',
      null,
    ])
      expect(safeAssetUrl(url)).toBeUndefined();
  });
});

describe('hashing for forge assets', () => {
  const hash = createHash('sha256').update('test').digest('hex');
  it('hashes a local blob incrementally', async () => {
    await expect(hashBlob(new Blob(['te', 'st']))).resolves.toEqual({ sha256: hash, size: 4 });
  });
  it('streams and hashes an HTTPS download, bounded and without credentials', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(init?.credentials).toBe('omit');
      return new Response(url.endsWith('/big') ? new Uint8Array(8) : 'test', {
        headers: { 'content-length': url.endsWith('/big') ? String(MAX_BINARY_BYTES + 1) : '4' },
      });
    }) as unknown as typeof globalThis.fetch;
    await expect(hashRemote('https://files.example/test', { fetch: fetchImpl })).resolves.toEqual({ sha256: hash, size: 4 });
    await expect(hashRemote('https://files.example/big', { fetch: fetchImpl })).rejects.toThrow('512 MiB');
    await expect(hashRemote('http://files.example/test', { fetch: fetchImpl })).rejects.toThrow('HTTPS');
    const denied = (async () => new Response('', { status: 403 })) as unknown as typeof globalThis.fetch;
    await expect(hashRemote('https://files.example/test', { fetch: denied })).rejects.toThrow('403');
  });
});
