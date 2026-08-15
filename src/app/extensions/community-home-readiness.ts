export type CommunityHomeCoreReadinessInput = {
  communityPubkey: string
  definitionPubkey: string
  expectedBootstrapKey: string
  permissionReadiness: "loading" | "ready" | "unavailable"
  bootstrapStatus: {
    key: string
    loading: boolean
    loaded: boolean
    error?: string
  }
}

export type CommunityHomeExtensionReadinessInput = CommunityHomeCoreReadinessInput & {
  roomsPresent: boolean
  expectedRoomCatalogKey: string
  firstRoomCatalogKey: string
  firstRoomCatalogTerminal: boolean
}

export type CommunityModeratorEvidenceStatus = "unresolved" | "loading" | "complete"

export const isCommunityHomeCoreReady = ({
  communityPubkey,
  definitionPubkey,
  expectedBootstrapKey,
  permissionReadiness,
  bootstrapStatus,
}: CommunityHomeCoreReadinessInput) =>
  Boolean(
    communityPubkey &&
    definitionPubkey === communityPubkey &&
    expectedBootstrapKey &&
    bootstrapStatus.key === expectedBootstrapKey &&
    bootstrapStatus.loaded &&
    !bootstrapStatus.loading &&
    !bootstrapStatus.error &&
    permissionReadiness === "ready",
  )

export const isCommunityHomeExtensionReady = ({
  roomsPresent,
  expectedRoomCatalogKey,
  firstRoomCatalogKey,
  firstRoomCatalogTerminal,
  ...core
}: CommunityHomeExtensionReadinessInput) =>
  isCommunityHomeCoreReady(core) &&
  (roomsPresent ||
    Boolean(
      expectedRoomCatalogKey &&
      firstRoomCatalogKey === expectedRoomCatalogKey &&
      firstRoomCatalogTerminal,
    ))

export const isCompleteCommunityModeratorEvidence = (
  expectedKey: string,
  state: {key: string; status: CommunityModeratorEvidenceStatus},
) => Boolean(expectedKey && state.key === expectedKey && state.status === "complete")
