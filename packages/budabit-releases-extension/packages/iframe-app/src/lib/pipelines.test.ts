import { describe, expect, it } from 'vitest';
import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { loadPipelineArtifacts } from './pipelines.js';
import { signed, testPubkey, testRepo } from './test-fixtures.js';

const run = (key = 1, commit = 'a'.repeat(40)) =>
  signed(
    {
      kind: 5401,
      tags: [
        ['a', testRepo().repoAddress],
        ['triggered-by', testPubkey()],
        ['publisher', testPubkey(3)],
        ['commit', commit],
      ],
    },
    key
  );
const artifact = (refs: string[] = []) =>
  signed(
    {
      kind: 1063,
      tags: [
        ['url', 'https://files.example/app'],
        ['x', 'b'.repeat(64)],
        ['filename', 'app'],
        ['m', 'application/octet-stream'],
        ...refs.map((id) => ['e', id]),
      ],
    },
    3
  );
const bridge = (runs: NostrEvent[], assets: NostrEvent[]) =>
  ({
    request: async (_: string, p: { filter: { kinds: number[]; authors: string[] } }) => ({
      status: 'ok',
      complete: true,
      // Worker and maintainer artifact queries are keyed on distinct author sets.
      events: (p.filter.kinds[0] === 5401 ? runs : assets).filter((e) =>
        p.filter.authors.includes(e.pubkey)
      ),
    }),
  }) as unknown as WidgetBridge;

describe('authenticated pipeline artifacts', () => {
  it('checks delegation reuse across repositories before assigning legacy artifacts or commits', async () => {
    const current = run();
    const other = signed({
      ...current,
      tags: current.tags.map((t) =>
        t[0] === 'a'
          ? ['a', `30617:${testPubkey()}:other-repo`]
          : t[0] === 'commit'
            ? ['commit', 'c'.repeat(40)]
            : t
      ),
    });
    const legacy = signed(
      {
        ...artifact(),
        tags: artifact().tags.map((t) =>
          t[0] === 'filename' ? ['filename', 'other-repo.bin'] : t
        ),
      },
      3
    );
    const data = await loadPipelineArtifacts(bridge([current, other], [legacy]), testRepo());
    expect(data.runs).toEqual([]);
    expect(data.artifactsByRun.size).toBe(0);
  });
  it('accepts legacy metadata only after complete cross-repository delegation discovery', async () => {
    const current = run();
    const other = signed({
      ...current,
      tags: current.tags.map((t) =>
        t[0] === 'a'
          ? ['a', `30617:${testPubkey()}:other-repo`]
          : t[0] === 'publisher'
            ? ['publisher', testPubkey(4)]
            : t
      ),
    });
    const data = await loadPipelineArtifacts(bridge([current, other], [artifact()]), testRepo());
    expect(data.runs.map((r) => r.id)).toEqual([current.id]);
    expect(data.artifactsByRun.get(current.id)?.[0]?.commitId).toBe('a'.repeat(40));
    const partial = {
      request: async () => ({ status: 'ok', complete: false, events: [current] }),
    } as unknown as WidgetBridge;
    await expect(loadPipelineArtifacts(partial, testRepo())).rejects.toThrow('incomplete');
  });
  it('rejects spoofed triggered-by, even with valid attacker signatures', async () => {
    expect(
      (await loadPipelineArtifacts(bridge([run(2)], [artifact()]), testRepo())).runs
    ).toHaveLength(0);
  });
  it('isolates a run and deduplicates events without worker votes', async () => {
    const r = run(),
      a = artifact([r.id]);
    const data = await loadPipelineArtifacts(bridge([r, r], [a, a]), testRepo());
    expect(data.artifactsByRun.get(r.id)).toHaveLength(1);
    expect(data.artifactsByRun.get(r.id)?.[0]?.commitId).toBe('a'.repeat(40));
  });
  it('rejects reused ambiguous publisher delegations', async () => {
    const data = await loadPipelineArtifacts(
      bridge([run(), run(1, 'c'.repeat(40))], [artifact()]),
      testRepo()
    );
    expect(data.runs).toHaveLength(0);
  });
  it('accepts runs pinned to a branch head and legacy 30618 coordinates, but not malformed commits', async () => {
    const headRun = signed(
      { kind: 5401, tags: run().tags.filter((t) => t[0] !== 'commit') },
      1
    );
    const withArtifactCommit = artifact([headRun.id]);
    const stamped = signed(
      { ...withArtifactCommit, tags: [...withArtifactCommit.tags, ['commit', 'e'.repeat(40)]] },
      3
    );
    let data = await loadPipelineArtifacts(bridge([headRun], [stamped]), testRepo());
    expect(data.runs[0]?.commitId).toBeUndefined();
    expect(data.artifactsByRun.get(headRun.id)?.[0]?.commitId).toBe('e'.repeat(40));

    const legacy = signed(
      { kind: 5401, tags: run().tags.map((t) => (t[0] === 'a' ? ['a', `30618:${testPubkey()}:repo`] : t)) },
      1
    );
    data = await loadPipelineArtifacts(bridge([legacy], [artifact([legacy.id])]), testRepo());
    expect(data.runs.map((r) => r.id)).toEqual([legacy.id]);

    const short = signed({ kind: 5401, tags: run().tags.map((t) => (t[0] === 'commit' ? ['commit', '1234'] : t)) }, 1);
    expect((await loadPipelineArtifacts(bridge([short], [artifact()]), testRepo())).runs).toEqual([]);
  });
  it('infers NIP-82 MIME types and platforms from CI artifact filenames', async () => {
    const r = run();
    const desktop = signed(
      {
        kind: 1063,
        tags: [
          ['url', 'https://files.example/app'],
          ['x', 'b'.repeat(64)],
          ['filename', 'app-2.0.0-darwin-arm64.dmg'],
          ['m', 'application/octet-stream'],
          ['e', r.id],
        ],
      },
      3
    );
    const data = await loadPipelineArtifacts(bridge([r], [desktop]), testRepo());
    expect(data.artifactsByRun.get(r.id)?.[0]).toMatchObject({
      mimeType: 'application/x-apple-diskimage',
      platforms: ['darwin-arm64'],
    });
  });
  it('accepts maintainer co-signed attestations from the Workflows tab and merges them by hash', async () => {
    const r = run();
    const worker = artifact([r.id]);
    // The Attestations tab re-signs the worker event's tags with the maintainer key.
    const cosigned = signed({ kind: 1063, tags: worker.tags }, 1);
    const maintainerOnly = signed(
      {
        kind: 1063,
        tags: worker.tags.map((t) =>
          t[0] === 'x' ? ['x', 'c'.repeat(64)] : t[0] === 'filename' ? ['filename', 'other'] : t
        ),
      },
      1
    );
    const unlinked = signed({ kind: 1063, tags: worker.tags.filter((t) => t[0] !== 'e') }, 1);
    const foreignRun = signed({ kind: 1063, tags: worker.tags.map((t) => (t[0] === 'e' ? ['e', 'd'.repeat(64)] : t)) }, 1);
    const data = await loadPipelineArtifacts(
      bridge([r], [worker, cosigned, maintainerOnly, unlinked, foreignRun]),
      testRepo()
    );
    const artifacts = data.artifactsByRun.get(r.id) ?? [];
    expect(artifacts.map((a) => [a.eventId, a.filename, a.attestedBy])).toEqual([
      [worker.id, 'app', [testPubkey()]],
      [maintainerOnly.id, 'other', [testPubkey()]],
    ]);
  });
  it('ignores attestations from outsiders even when they reference a real run', async () => {
    const r = run();
    const outsider = signed({ kind: 1063, tags: artifact([r.id]).tags }, 2);
    const data = await loadPipelineArtifacts(bridge([r], [outsider]), testRepo());
    expect(data.artifactsByRun.size).toBe(0);
  });
  it('rejects contradictory references and wrong artifact authors', async () => {
    const r = run();
    const data = await loadPipelineArtifacts(
      bridge(
        [r],
        [artifact(['d'.repeat(64)]), signed({ ...artifact(), tags: artifact().tags }, 2)]
      ),
      testRepo()
    );
    expect(data.artifactsByRun.size).toBe(0);
  });
});
