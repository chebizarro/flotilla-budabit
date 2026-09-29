import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { HEX_KEY, type RepoContext } from './context.js';
import type { Artifact, PipelineRun } from './types.js';
import { queryEvents, getRelays, requiredRelays, tagValue, tagValues } from './releases.js';
import { safeAssetUrl } from './binary.js';
import { classifyArtifact } from './assets.js';

const COMMIT_ID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const REPO_COORDINATE = /^3061[78]:/;

export interface PipelineArtifactData {
  runs: PipelineRun[];
  artifactsByRun: Map<string, Artifact[]>;
}

/**
 * Coordinates a Workflows run may use for this repository: the kind 30617
 * announcement address, or the kind 30618 state address older Hive CI runs
 * referenced for the same `pubkey:identifier`.
 */
export function acceptedRunCoordinates(repoAddress: string): string[] {
  return [repoAddress, repoAddress.replace(/^30617:/, '30618:')];
}

const integerTag = (event: NostrEvent, key: string): number | undefined => {
  const text = tagValue(event, key);
  return text !== undefined && /^\d+$/.test(text) && Number.isSafeInteger(Number(text))
    ? Number(text)
    : undefined;
};

/**
 * Authenticated runs and their artifacts.
 *
 * Two artifact sources are accepted, mirroring what the Workflows tab
 * produces and trusts:
 * - kind 1063 signed by a run's delegated `publisher` key (the worker), linked
 *   to the run by `e` or, for legacy events, by the unique delegation alone;
 * - kind 1063 co-signed by a current maintainer from the Workflows
 *   "Attestations" tab, which copies the worker event's tags including `e`.
 *   These must reference exactly one authenticated run.
 *
 * A maintainer copy of a hash the worker also published is folded into the
 * worker artifact as an attestation; a maintainer-only hash is offered as its
 * own artifact. A publisher delegation is accepted only from the authenticated
 * run author.
 */
export async function loadPipelineArtifacts(
  bridge: WidgetBridge,
  repo: RepoContext
): Promise<PipelineArtifactData> {
  const relays = getRelays(repo.repoRelays);
  const required = requiredRelays(repo.repoRelays);
  const runsByPublisher = new Map<string, PipelineRun>();
  const delegations = new Map<string, string>();
  const ambiguous = new Set<string>();
  const events = await queryEvents(
    bridge,
    relays,
    {
      kinds: [5401],
      authors: [...repo.maintainers],
      // Scan maintainer namespaces across ALL repositories. Filtering #a here
      // conceals reused publisher keys and misattributes unlinked legacy artifacts.
    },
    required
  );
  const coordinates = acceptedRunCoordinates(repo.repoAddress);
  for (const event of events) {
    const publisher = tagValue(event, 'publisher');
    const actor = tagValue(event, 'triggered-by');
    // The Workflows tab writes `commit` verbatim from an optional form field, so
    // an empty tag means "branch head at clone time". A present value must be a
    // full object id so it can be trusted for reproducibility.
    const commit = tagValue(event, 'commit') || undefined;
    if (event.kind !== 5401 || !repo.maintainers.includes(event.pubkey)) continue;
    for (const delegated of tagValues(event, 'publisher').filter((p) => HEX_KEY.test(p))) {
      const previous = delegations.get(delegated);
      if (previous && previous !== event.id) ambiguous.add(delegated);
      delegations.set(delegated, event.id);
    }
    const repoLinks = tagValues(event, 'a').filter((a) => REPO_COORDINATE.test(a));
    if (
      actor !== event.pubkey ||
      repoLinks.length !== 1 ||
      !coordinates.includes(repoLinks[0] ?? '') ||
      tagValues(event, 'publisher').length !== 1 ||
      !publisher ||
      !HEX_KEY.test(publisher) ||
      (commit !== undefined && !COMMIT_ID.test(commit))
    )
      continue;
    runsByPublisher.set(publisher, {
      id: event.id,
      workflowName: tagValue(event, 'workflow') ?? 'workflow',
      branch: tagValue(event, 'branch') ?? '',
      commitId: commit,
      createdAt: event.created_at,
      ephemeralPubkey: publisher,
      triggeredBy: event.pubkey,
    });
  }
  for (const publisher of ambiguous) runsByPublisher.delete(publisher);
  const runs = [...runsByPublisher.values()].sort(
    (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  );
  const artifactsByRun = new Map<string, Artifact[]>();
  if (!runs.length) return { runs, artifactsByRun };
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const [workerEvents, maintainerEvents] = await Promise.all([
    queryEvents(bridge, relays, { kinds: [1063], authors: [...runsByPublisher.keys()] }, required),
    queryEvents(bridge, relays, { kinds: [1063], authors: [...repo.maintainers] }, required),
  ]);
  const seen = new Set<string>();
  // `${run id}:${sha256}` → artifact, so maintainer copies merge into worker artifacts.
  const byHash = new Map<string, Artifact>();
  for (const event of [...workerEvents, ...maintainerEvents]) {
    const url = safeAssetUrl(tagValue(event, 'url'));
    const sha256 = tagValue(event, 'x');
    const refs = [...new Set(tagValues(event, 'e'))];
    const commit = tagValue(event, 'commit') || undefined;
    if (event.kind !== 1063 || !url || !sha256 || !HEX_KEY.test(sha256) || seen.has(event.id))
      continue;
    const publisherRun = runsByPublisher.get(event.pubkey);
    let run: PipelineRun | undefined;
    let attestedBy: string | undefined;
    if (publisherRun) {
      // Legacy unlinked events rely on a unique delegation in the completed
      // cross-repository maintainer scan. Conflicting references are never accepted.
      if (refs.some((id) => id !== publisherRun.id)) continue;
      run = publisherRun;
    } else if (repo.maintainers.includes(event.pubkey)) {
      // Attestations have no delegation: only the run link can attribute them.
      if (refs.length !== 1) continue;
      run = runsById.get(refs[0] ?? '');
      attestedBy = event.pubkey;
    }
    if (!run || (commit && run.commitId && commit !== run.commitId)) continue;
    seen.add(event.id);
    const key = `${run.id}:${sha256}`;
    const existing = byHash.get(key);
    if (existing) {
      if (attestedBy && !existing.attestedBy?.includes(attestedBy))
        existing.attestedBy = [...(existing.attestedBy ?? []), attestedBy];
      continue;
    }
    const filename = tagValue(event, 'filename') ?? tagValue(event, 'name') ?? sha256;
    // CI uploaders rarely declare NIP-82 metadata; infer the Appendix C MIME
    // type and Appendix A platforms from the filename so mobile and desktop
    // artifacts start from a store-ready classification the maintainer confirms.
    const classified = classifyArtifact({
      filename,
      mimeType: tagValue(event, 'm'),
      platforms: tagValues(event, 'f'),
    });
    const artifact: Artifact = {
      eventId: event.id,
      url,
      sha256,
      filename,
      mimeType: classified.mimeType,
      size: integerTag(event, 'size'),
      appId: tagValue(event, 'i'),
      version: tagValue(event, 'version'),
      platforms: classified.platforms,
      versionCode: integerTag(event, 'version_code'),
      apkCertificateHashes: tagValues(event, 'apk_certificate_hash'),
      minPlatformVersion: tagValue(event, 'min_platform_version'),
      targetPlatformVersion: tagValue(event, 'target_platform_version'),
      variant: tagValue(event, 'variant'),
      attestedBy: attestedBy ? [attestedBy] : [],
      pipelineRunId: run.id,
      workflowName: run.workflowName,
      branch: run.branch,
      commitId: run.commitId ?? commit,
    };
    byHash.set(key, artifact);
    artifactsByRun.set(run.id, [...(artifactsByRun.get(run.id) ?? []), artifact]);
  }
  return { runs, artifactsByRun };
}
