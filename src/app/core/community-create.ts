import {generateSecretKey, getPublicKey} from "nostr-tools/pure"
import type {EventTemplate, SignedEvent, TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND, parseCommunityId} from "./community-protocol"

export type CommunityCreationIntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

type CommunityCreationArtifacts = {
  prerequisites: EventTemplate[]
  definition: EventTemplate
}

type CreateCommunityOptions = {
  operationId: string
  ownerPubkey: string
  buildArtifacts: (communityId: string) => CommunityCreationArtifacts
  sign: (template: EventTemplate) => Promise<SignedEvent>
  publishAndVerifyExact: (event: SignedEvent) => Promise<TrustedEvent>
  validateDefinition?: (event: TrustedEvent) => boolean
  storage?: CommunityCreationIntentStorage
  generateSecretKey?: () => Uint8Array
  getPublicKey?: (secret: Uint8Array) => string
}

const INTENT_PREFIX = "budabit/community-create/"

export const getCommunityCreationIntentKey = (ownerPubkey: string, operationId: string) => {
  if (!operationId) throw new Error("Community creation operation ID is required.")
  return `${INTENT_PREFIX}${encodeURIComponent(ownerPubkey)}/${encodeURIComponent(operationId)}`
}

const readCommunityId = (
  storage: CommunityCreationIntentStorage,
  ownerPubkey: string,
  operationId: string,
) => {
  const raw = storage.getItem(getCommunityCreationIntentKey(ownerPubkey, operationId))
  if (!raw) return undefined

  try {
    const intent = JSON.parse(raw) as {
      operationId?: unknown
      ownerPubkey?: unknown
      communityId?: unknown
    }
    if (
      intent.operationId !== operationId ||
      intent.ownerPubkey !== ownerPubkey ||
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
  ownerPubkey,
  storage,
  makeSecret,
  derivePublicKey,
}: {
  operationId: string
  ownerPubkey: string
  storage: CommunityCreationIntentStorage
  makeSecret: () => Uint8Array
  derivePublicKey: (secret: Uint8Array) => string
}) => {
  const existing = readCommunityId(storage, ownerPubkey, operationId)
  if (existing) return existing

  const communityId = parseCommunityId(deriveThrowawayCommunityId(makeSecret, derivePublicKey))
  if (!communityId) throw new Error("Generated an invalid community ID.")

  storage.setItem(
    getCommunityCreationIntentKey(ownerPubkey, operationId),
    JSON.stringify({operationId, ownerPubkey, communityId}),
  )
  return communityId
}

const assertArtifacts = (communityId: string, artifacts: CommunityCreationArtifacts) => {
  if (artifacts.definition.kind !== COMMUNITY_DEFINITION_KIND) {
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
    if (event.kind === COMMUNITY_DEFINITION_KIND) {
      throw new Error("Community prerequisites must precede the single kind-32222 activation.")
    }
  }
}

const publishExactly = async (
  event: SignedEvent,
  ownerPubkey: string,
  publishAndVerifyExact: (event: SignedEvent) => Promise<TrustedEvent>,
) => {
  if (event.pubkey !== ownerPubkey) {
    throw new Error("Community artifacts must be signed by the owner.")
  }
  const readback = await publishAndVerifyExact(event)
  if (readback.id !== event.id) throw new Error("Relay did not read back the exact event.")
  return readback
}

export const createCommunity = async ({
  operationId,
  ownerPubkey,
  buildArtifacts,
  sign,
  publishAndVerifyExact,
  validateDefinition,
  storage = localStorage,
  generateSecretKey: makeSecret = generateSecretKey,
  getPublicKey: derivePublicKey = getPublicKey,
}: CreateCommunityOptions) => {
  const communityId = getOrCreateCommunityId({
    operationId,
    ownerPubkey,
    storage,
    makeSecret,
    derivePublicKey,
  })
  const artifacts = buildArtifacts(communityId)
  assertArtifacts(communityId, artifacts)
  const verifiedEvents: TrustedEvent[] = []

  for (const template of artifacts.prerequisites) {
    verifiedEvents.push(
      await publishExactly(await sign(template), ownerPubkey, publishAndVerifyExact),
    )
  }

  const signedDefinition = await sign(artifacts.definition)
  if (validateDefinition && !validateDefinition(signedDefinition)) {
    throw new Error("Community definition failed protocol validation before publication.")
  }
  const definition = await publishExactly(signedDefinition, ownerPubkey, publishAndVerifyExact)
  if (validateDefinition && !validateDefinition(definition)) {
    throw new Error("Community definition failed protocol validation after relay readback.")
  }
  verifiedEvents.push(definition)
  storage.removeItem(getCommunityCreationIntentKey(ownerPubkey, operationId))

  return {communityId, definition, verifiedEvents}
}
