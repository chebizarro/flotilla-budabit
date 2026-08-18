import {generateSecretKey, getPublicKey} from "nostr-tools/pure"
import type {EventTemplate, SignedEvent, TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND_V2, parseCommunityId} from "./community-v2"

export type CommunityCreationIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

type CommunityCreationArtifacts = {
  prerequisites: EventTemplate[]
  definition: EventTemplate
}

type CreateCommunityV2Options = {
  operationId: string
  controllerPubkey: string
  buildArtifacts: (communityId: string) => CommunityCreationArtifacts
  sign: (template: EventTemplate) => Promise<SignedEvent>
  publishAndVerifyExact: (event: SignedEvent) => Promise<TrustedEvent>
  storage?: CommunityCreationIntentStorage
  generateSecretKey?: () => Uint8Array
  getPublicKey?: (secret: Uint8Array) => string
}

const INTENT_PREFIX = "budabit/community-create-v2/"

export const getCommunityCreationIntentKey = (controllerPubkey: string, operationId: string) => {
  if (!operationId) throw new Error("Community creation operation ID is required.")
  return `${INTENT_PREFIX}${encodeURIComponent(controllerPubkey)}/${encodeURIComponent(operationId)}`
}

const readCommunityId = (
  storage: CommunityCreationIntentStorage,
  controllerPubkey: string,
  operationId: string,
) => {
  const raw = storage.getItem(getCommunityCreationIntentKey(controllerPubkey, operationId))
  if (!raw) return undefined

  try {
    const intent = JSON.parse(raw) as {
      operationId?: unknown
      controllerPubkey?: unknown
      communityId?: unknown
    }
    if (
      intent.operationId !== operationId ||
      intent.controllerPubkey !== controllerPubkey ||
      typeof intent.communityId !== "string"
    ) {
      return undefined
    }
    return parseCommunityId(intent.communityId)
  } catch {
    return undefined
  }
}

const deriveThrowawayCommunityId = (
  makeSecret: () => Uint8Array,
  derivePublicKey: (secret: Uint8Array) => string,
) => {
  const secret = makeSecret()

  try {
    return derivePublicKey(secret)
  } finally {
    secret.fill(0)
  }
}

const getOrCreateCommunityId = ({
  operationId,
  controllerPubkey,
  storage,
  makeSecret,
  derivePublicKey,
}: {
  operationId: string
  controllerPubkey: string
  storage: CommunityCreationIntentStorage
  makeSecret: () => Uint8Array
  derivePublicKey: (secret: Uint8Array) => string
}) => {
  const existing = readCommunityId(storage, controllerPubkey, operationId)
  if (existing) return existing

  const communityId = parseCommunityId(deriveThrowawayCommunityId(makeSecret, derivePublicKey))
  if (!communityId) throw new Error("Generated an invalid community ID.")

  storage.setItem(
    getCommunityCreationIntentKey(controllerPubkey, operationId),
    JSON.stringify({operationId, controllerPubkey, communityId}),
  )
  return communityId
}

const assertArtifacts = (communityId: string, artifacts: CommunityCreationArtifacts) => {
  if (artifacts.definition.kind !== COMMUNITY_DEFINITION_KIND_V2) {
    throw new Error("Community activation must be a kind-32222 event.")
  }
  const identifiers = artifacts.definition.tags.filter(tag => tag[0] === "d")
  if (
    identifiers.length !== 1 ||
    identifiers[0].length !== 2 ||
    identifiers[0][1] !== communityId
  ) {
    throw new Error("Community activation does not contain the intended community ID.")
  }

  for (const event of artifacts.prerequisites) {
    if (event.kind === 0) throw new Error("Community creation must not publish a kind-0 event.")
    if (event.kind === COMMUNITY_DEFINITION_KIND_V2) {
      throw new Error("Community prerequisites must precede the single kind-32222 activation.")
    }
  }
}

const publishExactly = async (
  event: SignedEvent,
  controllerPubkey: string,
  publishAndVerifyExact: (event: SignedEvent) => Promise<TrustedEvent>,
) => {
  if (event.pubkey !== controllerPubkey) {
    throw new Error("Community artifacts must be signed by the controller.")
  }
  const readback = await publishAndVerifyExact(event)
  if (readback.id !== event.id) throw new Error("Relay did not read back the exact event.")
  return readback
}

export const createCommunityV2 = async ({
  operationId,
  controllerPubkey,
  buildArtifacts,
  sign,
  publishAndVerifyExact,
  storage = localStorage,
  generateSecretKey: makeSecret = generateSecretKey,
  getPublicKey: derivePublicKey = getPublicKey,
}: CreateCommunityV2Options) => {
  const communityId = getOrCreateCommunityId({
    operationId,
    controllerPubkey,
    storage,
    makeSecret,
    derivePublicKey,
  })
  const artifacts = buildArtifacts(communityId)
  assertArtifacts(communityId, artifacts)
  const verifiedEvents: TrustedEvent[] = []

  for (const template of artifacts.prerequisites) {
    verifiedEvents.push(
      await publishExactly(await sign(template), controllerPubkey, publishAndVerifyExact),
    )
  }

  const definition = await publishExactly(
    await sign(artifacts.definition),
    controllerPubkey,
    publishAndVerifyExact,
  )
  verifiedEvents.push(definition)
  storage.removeItem(getCommunityCreationIntentKey(controllerPubkey, operationId))

  return {communityId, definition, verifiedEvents}
}
