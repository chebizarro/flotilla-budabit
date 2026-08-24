import {pubkey, publishThunk, signer} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {APP_BUILD_HASH, APP_BUILD_ID} from "@app/core/build-info"
import {makeBudabitBlossomAuthEvent, makeBudabitBlossomAuthHeader} from "@app/util/blossom-auth"
import {
  PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  PERFORMANCE_DIAGNOSTICS_DEFAULT_RELAY,
  PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  type PreparedPerformanceDiagnosticsArtifact,
} from "@app/core/performance-diagnostics"

export const PERFORMANCE_DIAGNOSTICS_MANIFEST_KIND = 30078
export const PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG = "budabit-performance-latest"
export const PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX = "budabit-performance-run:"

export type PerformanceDiagnosticsPublishStage =
  | "preparing"
  | "signing-upload"
  | "uploading"
  | "signing-run"
  | "publishing-run"
  | "signing-latest"
  | "publishing-latest"
  | "complete"

export type PerformanceDiagnosticsManifestInput = {
  artifact: PreparedPerformanceDiagnosticsArtifact
  artifactUrl: string
  runId: string
  routes: string[]
  dTag: string
  createdAt?: number
}

type PerformanceDiagnosticsEventTemplate = {
  kind: number
  created_at: number
  content: string
  tags: string[][]
}

type Signer = {sign: (template: PerformanceDiagnosticsEventTemplate) => Promise<TrustedEvent>}

type PublishDependencies = {
  getIdentity: () => {pubkey: string; signer: Signer | undefined}
  upload: (
    artifact: PreparedPerformanceDiagnosticsArtifact,
    server: string,
    authorization: string,
  ) => Promise<{url: string; sha256: string; size?: number}>
  publish: (event: TrustedEvent, relays: string[]) => Promise<number>
}

export const buildPerformanceDiagnosticsManifest = ({
  artifact,
  artifactUrl,
  runId,
  routes,
  dTag,
  createdAt = Math.floor(Date.now() / 1000),
}: PerformanceDiagnosticsManifestInput): PerformanceDiagnosticsEventTemplate => {
  const content = JSON.stringify({
    schema: "budabit-performance-manifest-v1",
    artifact: {
      url: artifactUrl,
      sha256: artifact.sha256,
      bytes: artifact.bytes.length,
      uncompressedBytes: artifact.uncompressedBytes,
      encoding: artifact.encoding,
      contentType: artifact.contentType,
    },
    runId,
    routes,
    build: {id: APP_BUILD_ID, hash: APP_BUILD_HASH},
    diagnosticsSchemaVersion: PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION,
  })

  return {
    kind: PERFORMANCE_DIAGNOSTICS_MANIFEST_KIND,
    created_at: createdAt,
    content,
    tags: [
      ["d", dTag],
      ["x", artifact.sha256],
      ["url", artifactUrl],
      ["run", runId],
      ["schema", String(PERFORMANCE_DIAGNOSTICS_SCHEMA_VERSION)],
      ["encoding", artifact.encoding],
      ["size", String(artifact.bytes.length)],
      ["build", APP_BUILD_ID, APP_BUILD_HASH],
      ...Array.from(new Set(routes)).map(route => ["route", route]),
    ],
  }
}

export const uploadPerformanceDiagnosticsArtifact = async (
  artifact: PreparedPerformanceDiagnosticsArtifact,
  server = PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  fetcher: typeof fetch = fetch,
  authorization = "",
) => {
  const origin = server.replace(/\/+$/, "")
  const response = await fetcher(`${origin}/upload`, {
    method: "PUT",
    headers: {
      "content-type": artifact.contentType,
      "x-sha-256": artifact.sha256,
      ...(authorization ? {authorization} : {}),
    },
    body: artifact.bytes as BodyInit,
  })
  if (!response.ok) throw new Error(`Blossom upload failed (${response.status})`)

  const descriptor = (await response.json()) as {url?: unknown; sha256?: unknown; size?: unknown}
  const sha256 = typeof descriptor.sha256 === "string" ? descriptor.sha256.toLowerCase() : ""
  const url = typeof descriptor.url === "string" ? descriptor.url : ""
  if (!url || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Blossom returned an invalid blob descriptor")
  }
  if (sha256 !== artifact.sha256) throw new Error("Blossom artifact hash mismatch")

  return {
    url,
    sha256,
    size: typeof descriptor.size === "number" ? descriptor.size : undefined,
  }
}

const defaultPublish = async (event: TrustedEvent, relays: string[]) => {
  const thunk = publishThunk({event, relays})
  await thunk.complete
  return Object.values(thunk.results || {}).filter(result => result?.status === "success").length
}

const defaultDependencies: PublishDependencies = {
  getIdentity: () => ({
    pubkey: pubkey.get() || "",
    signer: signer.get() as unknown as Signer | undefined,
  }),
  upload: (artifact, server, authorization) =>
    uploadPerformanceDiagnosticsArtifact(artifact, server, fetch, authorization),
  publish: defaultPublish,
}

export const publishPerformanceDiagnosticsArtifact = async ({
  artifact,
  runId,
  routes,
  blossomServer = PERFORMANCE_DIAGNOSTICS_DEFAULT_BLOSSOM,
  relays = [PERFORMANCE_DIAGNOSTICS_DEFAULT_RELAY],
  onStage,
  dependencies = defaultDependencies,
}: {
  artifact: PreparedPerformanceDiagnosticsArtifact
  runId: string
  routes: string[]
  blossomServer?: string
  relays?: string[]
  onStage?: (stage: PerformanceDiagnosticsPublishStage) => void
  dependencies?: PublishDependencies
}) => {
  const initial = dependencies.getIdentity()
  if (!initial.pubkey) throw new Error("Log in before publishing diagnostics")
  if (!initial.signer) throw new Error("No active signer available")
  const assertIdentity = () => {
    const current = dependencies.getIdentity()
    if (current.pubkey !== initial.pubkey || current.signer !== initial.signer) {
      throw new Error("Active account changed during diagnostics publication")
    }
  }

  onStage?.("signing-upload")
  const uploadAuthEvent = await initial.signer.sign(
    makeBudabitBlossomAuthEvent({
      action: "upload",
      server: blossomServer,
      hashes: [artifact.sha256],
    }),
  )
  assertIdentity()
  if (uploadAuthEvent.pubkey !== initial.pubkey)
    throw new Error("Signer returned the wrong account")

  onStage?.("uploading")
  const uploaded = await dependencies.upload(
    artifact,
    blossomServer,
    makeBudabitBlossomAuthHeader(uploadAuthEvent),
  )
  assertIdentity()

  const publishManifest = async (
    dTag: string,
    signStage: PerformanceDiagnosticsPublishStage,
    publishStage: PerformanceDiagnosticsPublishStage,
  ) => {
    onStage?.(signStage)
    const event = await initial.signer!.sign(
      buildPerformanceDiagnosticsManifest({
        artifact,
        artifactUrl: uploaded.url,
        runId,
        routes,
        dTag,
      }),
    )
    assertIdentity()
    if (event.pubkey !== initial.pubkey) throw new Error("Signer returned the wrong account")

    onStage?.(publishStage)
    const accepted = await dependencies.publish(event, relays)
    assertIdentity()
    if (accepted < 1) throw new Error("Diagnostics manifest was not accepted by any relay")
    return event
  }

  const runEvent = await publishManifest(
    `${PERFORMANCE_DIAGNOSTICS_RUN_D_TAG_PREFIX}${runId}`,
    "signing-run",
    "publishing-run",
  )
  const latestEvent = await publishManifest(
    PERFORMANCE_DIAGNOSTICS_LATEST_D_TAG,
    "signing-latest",
    "publishing-latest",
  )
  onStage?.("complete")

  return {uploaded, runEvent, latestEvent, pubkey: initial.pubkey}
}
