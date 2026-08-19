import {schnorr} from "@noble/curves/secp256k1"
import * as nip19 from "nostr-tools/nip19"
import type {EventContent, Filter, TrustedEvent} from "@welshman/util"

export const COMMUNITY_DEFINITION_KIND_V2 = 32222
export const TARGETED_PUBLICATION_KIND_V2 = 30222
export const MAX_TARGET_COMMUNITIES_V2 = 12

declare const communityIdBrand: unique symbol
declare const controllerPubkeyBrand: unique symbol

export type CommunityId = string & {[communityIdBrand]: true}
export type ControllerPubkey = string & {[controllerPubkeyBrand]: true}

export type CommunityPointer = {
  kind: typeof COMMUNITY_DEFINITION_KIND_V2
  controllerPubkey: ControllerPubkey
  communityId: CommunityId
  address: string
  cacheKey: string
  naddr: string
  relayHints: string[]
}

export type CommunityMetadataV2 = {
  name: string
  description?: string
  picture?: string
  banner?: string
  website?: string
  location?: string
  geohash?: string
}

export type CommunitySectionKindV2 = {kind: number; subtype?: string}
export type CommunityProfileListRefV2 = {address: string; relay?: string}
export type CommunityBadgeRefV2 = {address: string; relay?: string}
export type CommunityRetentionV2 = {kind: number; value: number; type: "time" | "count"}
export type CommunityMintV2 = {url: string; type?: string}
export type CommunityTermsV2 = {reference: string; relay?: string}
export type CommunityServiceV2 = {
  name: string
  pubkey: ControllerPubkey
  requestRelay: string
  handlerAddress: string
  handlerRelay: string
}

export type CommunitySectionV2 = {
  name: string
  kinds: CommunitySectionKindV2[]
  profileLists: CommunityProfileListRefV2[]
  badges: CommunityBadgeRefV2[]
  retention: CommunityRetentionV2[]
}

export type CommunitySectionInputV2 = {
  name: string
  kinds: CommunitySectionKindV2[]
  profileLists: CommunityProfileListRefV2[]
  badges?: CommunityBadgeRefV2[]
  retention?: CommunityRetentionV2[]
}

export type CommunityDefinitionV2 = {
  event: TrustedEvent
  pointer: CommunityPointer
  communityId: CommunityId
  controllerPubkey: ControllerPubkey
  metadata: CommunityMetadataV2
  relays: string[]
  blossomServers: string[]
  graspServers: string[]
  mints: CommunityMintV2[]
  terms?: CommunityTermsV2
  services: CommunityServiceV2[]
  sections: CommunitySectionV2[]
  sourceTags: string[][]
}

export type BuildCommunityDefinitionV2Params = Omit<CommunityMetadataV2, "name"> & {
  communityId: string
  name: string
  relays: string[]
  blossomServers?: string[]
  graspServers?: string[]
  mints?: Array<{url: string; type?: string}>
  terms?: {reference: string; relay?: string}
  services?: Array<{
    name: string
    pubkey: string
    requestRelay: string
    handlerAddress: string
    handlerRelay: string
  }>
  sections: CommunitySectionInputV2[]
}

export type TargetedPublicationSourceV2 =
  | {type: "a"; value: string; relay?: string}
  | {type: "e"; value: string; relay?: string; pubkey?: string}

export type TargetedPublicationV2 = {
  id: string
  kind: number
  source?: TargetedPublicationSourceV2
  communities: CommunityPointer[]
}

export type TargetedPublicationTemplateV2 = EventContent & {
  kind: typeof TARGETED_PUBLICATION_KIND_V2
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const GEOHASH = /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/
const CHILD_PURPOSE = /^[a-z][a-z0-9-]{0,31}$/
const SECTION_PURPOSE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SECTION_SHARD = /^(?:[2-9]|[1-9][0-9]+)$/
const SERVICE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
const MINT_TYPE = /^[\x21-\x7e]{1,32}$/
const utf8Length = (value: string) => new TextEncoder().encode(value).length

const isLiftableXOnlyKey = (value: string) => {
  if (!LOWER_HEX_64.test(value)) return false

  try {
    schnorr.utils.lift_x(BigInt(`0x${value}`))
    return true
  } catch {
    return false
  }
}

export const parseCommunityId = (value: string): CommunityId | undefined =>
  isLiftableXOnlyKey(value) ? (value as CommunityId) : undefined

export const parseControllerPubkey = (value: string): ControllerPubkey | undefined =>
  isLiftableXOnlyKey(value) ? (value as ControllerPubkey) : undefined

const normalizeUrl = (
  value: string | undefined,
  schemes: readonly string[],
): string | undefined => {
  if (!value || value !== value.trim() || utf8Length(value) > 2048) return undefined

  try {
    const url = new URL(value)
    if (
      !schemes.includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return undefined
    }

    let normalized = url.toString()
    if (url.pathname === "/" && !url.search) normalized = normalized.slice(0, -1)

    return normalized
  } catch {
    return undefined
  }
}

export const normalizeCommunityRelayV2 = (value?: string) => normalizeUrl(value, ["wss:"])

const normalizeHttpsUrl = (value?: string) => normalizeUrl(value, ["https:"])
const normalizeWebsite = (value?: string) => normalizeUrl(value, ["http:", "https:"])

const normalizeRelayList = (values: string[], maximum: number) => {
  const result: string[] = []

  for (const value of values) {
    const relay = normalizeCommunityRelayV2(value)
    if (!relay || result.includes(relay)) continue
    result.push(relay)
    if (result.length === maximum) break
  }

  return result
}

export const makeCommunityPointer = ({
  controllerPubkey,
  communityId,
  relayHints = [],
}: {
  controllerPubkey: string
  communityId: string
  relayHints?: string[]
}): CommunityPointer | undefined => {
  const controller = parseControllerPubkey(controllerPubkey)
  const id = parseCommunityId(communityId)
  if (!controller || !id) return undefined

  const address = `${COMMUNITY_DEFINITION_KIND_V2}:${controller}:${id}`
  const relays = normalizeRelayList(relayHints, 3)

  return {
    kind: COMMUNITY_DEFINITION_KIND_V2,
    controllerPubkey: controller,
    communityId: id,
    address,
    cacheKey: address,
    naddr: nip19.naddrEncode({
      kind: COMMUNITY_DEFINITION_KIND_V2,
      pubkey: controller,
      identifier: id,
      relays,
    }),
    relayHints: relays,
  }
}

export const parseCommunityDefinitionAddress = (value: string) => {
  const [kind, controllerPubkey, communityId, ...extra] = value.split(":")
  if (kind !== String(COMMUNITY_DEFINITION_KIND_V2) || extra.length > 0) return undefined

  return makeCommunityPointer({controllerPubkey, communityId})
}

export const parseCommunityNaddr = (value: string): CommunityPointer | undefined => {
  try {
    const decoded = nip19.decode(value)
    if (decoded.type !== "naddr" || decoded.data.kind !== COMMUNITY_DEFINITION_KIND_V2) {
      return undefined
    }

    return makeCommunityPointer({
      controllerPubkey: decoded.data.pubkey,
      communityId: decoded.data.identifier,
      relayHints: decoded.data.relays,
    })
  } catch {
    return undefined
  }
}

export const communityPointersEqual = (
  first: Pick<CommunityPointer, "address"> | undefined,
  second: Pick<CommunityPointer, "address"> | undefined,
) => Boolean(first && second && first.address === second.address)

export const makeCommunityScopeTagsV2 = (communityIdValue: string, tags: string[][] = []) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId) throw new Error("Invalid community ID.")
  if (tags.some(tag => tag[0] === "h")) {
    throw new Error("Conflicting community scope tag.")
  }

  return [["h", communityId], ...tags.map(tag => [...tag])]
}

export const makeCommunityAuthorityTagsV2 = (
  community: CommunityPointer,
  relay?: string,
  tags: string[][] = [],
) => {
  const pointer = makeCommunityPointer({
    controllerPubkey: community.controllerPubkey,
    communityId: community.communityId,
    relayHints: community.relayHints,
  })
  const normalizedRelay = relay ? normalizeCommunityRelayV2(relay) : undefined
  if (!pointer || pointer.address !== community.address || (relay && !normalizedRelay)) {
    throw new Error("Invalid community authority.")
  }
  if (tags.some(tag => tag[0] === "a" && tag[3] === "community")) {
    throw new Error("Conflicting community authority tag.")
  }

  return makeCommunityScopeTagsV2(pointer.communityId, [
    ["a", pointer.address, normalizedRelay || "", "community"],
    ...tags,
  ])
}

export const parseCommunityAuthorityV2 = (
  event: Pick<TrustedEvent, "tags">,
): CommunityPointer | undefined => {
  const hTags = event.tags.filter(tag => tag[0] === "h")
  const authorityTags = event.tags.filter(tag => tag[0] === "a" && tag[3] === "community")
  if (
    hTags.length !== 1 ||
    !exactTag(hTags[0], 2) ||
    authorityTags.length !== 1 ||
    !exactTag(authorityTags[0], 4)
  ) {
    return undefined
  }

  const communityId = parseCommunityId(hTags[0][1] || "")
  const addressPointer = parseCommunityDefinitionAddress(authorityTags[0][1] || "")
  const relay = authorityTags[0][2] ? normalizeCommunityRelayV2(authorityTags[0][2]) : undefined
  if (
    !communityId ||
    !addressPointer ||
    addressPointer.communityId !== communityId ||
    (authorityTags[0][2] && relay !== authorityTags[0][2])
  ) {
    return undefined
  }

  return makeCommunityPointer({
    controllerPubkey: addressPointer.controllerPubkey,
    communityId,
    relayHints: relay ? [relay] : [],
  })
}

const makeCommunityChildSlug = (value: string, fallback: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "") || fallback

export const makeCommunityChildIdentifier = (
  communityIdValue: string,
  purpose: string,
  value: string,
) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !CHILD_PURPOSE.test(purpose)) return undefined
  const slug = makeCommunityChildSlug(value, purpose)
  const identifier = `budabit-${communityId}-${slug}`

  return utf8Length(identifier) <= 200 ? identifier : undefined
}

export const makeCommunityProfileListIdentifier = (communityIdValue: string, value: string) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !SECTION_PURPOSE.test(value)) return undefined
  const identifier = `${communityId}-${value}`
  return utf8Length(identifier) <= 200 ? identifier : undefined
}

export const parseCommunityProfileListIdentifier = (
  communityIdValue: string,
  identifier: string,
) => {
  const communityId = parseCommunityId(communityIdValue)
  if (!communityId || !identifier.startsWith(`${communityId}-`) || utf8Length(identifier) > 200) {
    return undefined
  }
  const suffix = identifier.slice(communityId.length + 1)
  const [purpose, shard, ...extra] = suffix.split(".")
  if (!SECTION_PURPOSE.test(purpose) || extra.length > 0 || (shard && !SECTION_SHARD.test(shard))) {
    return undefined
  }
  return {purpose, ...(shard ? {shard: Number(shard)} : {})}
}

export const getCommunitySectionPurposeV2 = (
  communityIdValue: string,
  section: Pick<CommunitySectionV2, "name" | "profileLists">,
) => {
  for (const ref of section.profileLists) {
    const identifier = ref.address.split(":").slice(2).join(":")
    const parsed = parseCommunityProfileListIdentifier(communityIdValue, identifier)
    if (parsed) return parsed.purpose
  }

  const purpose = makeCommunityChildSlug(section.name, "section")
  return SECTION_PURPOSE.test(purpose) ? purpose : undefined
}

const parseCanonicalKind = (value: string | undefined) => {
  if (!value || !CANONICAL_UINT.test(value)) return undefined
  const kind = Number(value)
  return Number.isInteger(kind) && kind <= 65535 ? kind : undefined
}

const parseAddress = (value: string, requiredKind?: number) => {
  const [kindValue, pubkeyValue, ...identifierParts] = value.split(":")
  const kind = parseCanonicalKind(kindValue)
  const pubkey = parseControllerPubkey(pubkeyValue || "")
  const identifier = identifierParts.join(":")
  if (
    kind === undefined ||
    kind < 30000 ||
    kind >= 40000 ||
    (requiredKind !== undefined && kind !== requiredKind)
  ) {
    return undefined
  }
  if (!pubkey || !identifier || utf8Length(identifier) > 200) return undefined

  return {kind, pubkey, identifier, address: `${kind}:${pubkey}:${identifier}`}
}

const parseReference = (value: string) => LOWER_HEX_64.test(value) || Boolean(parseAddress(value))

const exactTag = (tag: string[], size: number) => tag.length === size
const getTags = (tags: string[][], name: string) => tags.filter(tag => tag[0] === name)
const getSingleton = (tags: string[][], name: string, sizes: number[]) => {
  const matches = getTags(tags, name)
  if (matches.length > 1) return null
  if (matches.length === 0) return undefined
  return sizes.includes(matches[0].length) ? matches[0] : null
}

const parseBoundedText = (value: string | undefined, minimum: number, maximum: number) => {
  if (value === undefined || value !== value.trim()) return undefined
  const size = utf8Length(value)
  return size >= minimum && size <= maximum ? value : undefined
}

const parseSection = (tags: string[][]): CommunitySectionV2 | undefined => {
  const content = tags[0]
  const name = exactTag(content, 2) ? parseBoundedText(content[1], 1, 100) : undefined
  if (!name) return undefined

  const kinds: CommunitySectionKindV2[] = []
  const profileLists: CommunityProfileListRefV2[] = []
  const badges: CommunityBadgeRefV2[] = []
  const retention: CommunityRetentionV2[] = []

  for (const tag of tags.slice(1)) {
    if (tag[0] === "k") {
      if (![2, 3].includes(tag.length)) return undefined
      const kind = parseCanonicalKind(tag[1])
      const subtype = tag.length === 3 ? parseBoundedText(tag[2], 1, 64) : undefined
      if (kind === undefined || (tag.length === 3 && !subtype)) return undefined
      kinds.push(subtype ? {kind, subtype} : {kind})
    } else if (tag[0] === "a" || tag[0] === "badge") {
      if (![2, 3].includes(tag.length)) return undefined
      const ref = parseAddress(tag[1] || "", tag[0] === "a" ? 30000 : 30009)
      const relay = tag[2] ? normalizeCommunityRelayV2(tag[2]) : undefined
      if (!ref || (tag[2] && !relay)) return undefined
      const item = relay ? {address: ref.address, relay} : {address: ref.address}
      if (tag[0] === "a") profileLists.push(item)
      else badges.push(item)
    } else if (tag[0] === "retention") {
      if (!exactTag(tag, 4)) return undefined
      const kind = parseCanonicalKind(tag[1])
      const value = CANONICAL_UINT.test(tag[2] || "") ? Number(tag[2]) : 0
      const type = tag[3]
      if (
        kind === undefined ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        (type !== "time" && type !== "count")
      ) {
        return undefined
      }
      retention.push({kind, value, type})
    }
  }

  if (kinds.length === 0 || profileLists.length === 0) return undefined
  return {name, kinds, profileLists, badges, retention}
}

const parseOptionalUrlTag = (
  tags: string[][],
  name: string,
  normalizer: (value?: string) => string | undefined,
) => {
  const tag = getSingleton(tags, name, [2])
  if (tag === null) return null
  if (!tag) return undefined
  return normalizer(tag[1]) || null
}

const parseOptionalTextTag = (tags: string[][], name: string, maximum: number) => {
  const tag = getSingleton(tags, name, [2])
  if (tag === null) return null
  if (!tag) return undefined
  return parseBoundedText(tag[1], 1, maximum) || null
}

const SECTION_TAGS = new Set(["k", "a", "badge", "retention"])
const TOP_LEVEL_TAGS = new Set([
  "d",
  "name",
  "description",
  "picture",
  "banner",
  "website",
  "r",
  "blossom",
  "grasp",
  "mint",
  "location",
  "g",
  "tos",
  "service",
])

const parseMintTags = (tags: string[][]): CommunityMintV2[] | undefined => {
  const mintTags = getTags(tags, "mint")
  if (mintTags.length > 20) return undefined
  const result: CommunityMintV2[] = []
  const seen = new Set<string>()
  for (const tag of mintTags) {
    if (![2, 3].includes(tag.length)) return undefined
    const url = normalizeHttpsUrl(tag[1])
    const type = tag[2]
    if (!url || url !== tag[1] || (type && !MINT_TYPE.test(type))) return undefined
    const key = `${url}\u0000${type || ""}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(type ? {url, type} : {url})
  }
  return result
}

const parseTermsTag = (tags: string[][]): CommunityTermsV2 | null | undefined => {
  const tag = getSingleton(tags, "tos", [2, 3])
  if (tag === null) return null
  if (!tag) return undefined
  const relay = tag[2] ? normalizeCommunityRelayV2(tag[2]) : undefined
  if (!parseReference(tag[1]) || (tag[2] && (!relay || relay !== tag[2]))) return null
  return relay ? {reference: tag[1], relay} : {reference: tag[1]}
}

const parseServiceTags = (tags: string[][]): CommunityServiceV2[] | undefined => {
  const serviceTags = getTags(tags, "service")
  if (serviceTags.length > 50) return undefined
  const result: CommunityServiceV2[] = []
  const seen = new Set<string>()
  for (const tag of serviceTags) {
    if (!exactTag(tag, 6) || !SERVICE_NAME.test(tag[1])) return undefined
    const pubkey = parseControllerPubkey(tag[2])
    const requestRelay = normalizeCommunityRelayV2(tag[3])
    const handler = parseAddress(tag[4])
    const handlerRelay = normalizeCommunityRelayV2(tag[5])
    if (
      !pubkey ||
      !requestRelay ||
      requestRelay !== tag[3] ||
      !handler ||
      !handlerRelay ||
      handlerRelay !== tag[5]
    ) {
      return undefined
    }
    const key = tag.join("\u0000")
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      name: tag[1],
      pubkey,
      requestRelay,
      handlerAddress: handler.address,
      handlerRelay,
    })
  }
  return result
}

export const parseCommunityDefinitionV2 = (
  event: TrustedEvent,
): CommunityDefinitionV2 | undefined => {
  if (event.kind !== COMMUNITY_DEFINITION_KIND_V2 || event.content !== "") return undefined
  const controllerPubkey = parseControllerPubkey(event.pubkey)
  if (!controllerPubkey) return undefined

  const tags = event.tags || []
  const dTags = getTags(tags, "d")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2)) return undefined
  const communityId = parseCommunityId(dTags[0][1] || "")
  if (!communityId || getTags(tags, "h").length > 0) return undefined

  const nameTag = getSingleton(tags, "name", [2])
  const name = nameTag && nameTag !== null ? parseBoundedText(nameTag[1], 1, 100) : undefined
  if (!name) return undefined

  const relayTags = getTags(tags, "r")
  if (relayTags.length < 1 || relayTags.length > 20) return undefined
  const relays: string[] = []
  for (const tag of relayTags) {
    if (!exactTag(tag, 2)) return undefined
    const relay = normalizeCommunityRelayV2(tag[1])
    if (!relay || relay !== tag[1]) return undefined
    if (!relays.includes(relay)) relays.push(relay)
  }

  const description = parseOptionalTextTag(tags, "description", 4096)
  const location = parseOptionalTextTag(tags, "location", 256)
  const picture = parseOptionalUrlTag(tags, "picture", normalizeHttpsUrl)
  const banner = parseOptionalUrlTag(tags, "banner", normalizeHttpsUrl)
  const website = parseOptionalUrlTag(tags, "website", normalizeWebsite)
  const geohashTag = getSingleton(tags, "g", [2])
  const geohash =
    geohashTag && geohashTag !== null && GEOHASH.test(geohashTag[1])
      ? geohashTag[1]
      : geohashTag
        ? null
        : undefined
  if ([description, location, picture, banner, website, geohash].includes(null)) return undefined

  const blossomTags = getTags(tags, "blossom")
  const graspTags = getTags(tags, "grasp")
  if (blossomTags.length > 20 || graspTags.length > 20) return undefined
  const blossomServers: string[] = []
  const graspServers: string[] = []
  for (const [items, normalizer, output] of [
    [blossomTags, normalizeHttpsUrl, blossomServers],
    [graspTags, normalizeCommunityRelayV2, graspServers],
  ] as const) {
    for (const tag of items) {
      if (!exactTag(tag, 2)) return undefined
      const value = normalizer(tag[1])
      if (!value || value !== tag[1]) return undefined
      if (!output.includes(value)) output.push(value)
    }
  }

  const mints = parseMintTags(tags)
  const terms = parseTermsTag(tags)
  const services = parseServiceTags(tags)
  if (!mints || terms === null || !services) return undefined

  const rawSections: string[][][] = []
  let currentSection: string[][] | undefined
  for (const tag of tags) {
    if (tag[0] === "content") {
      currentSection = [tag]
      rawSections.push(currentSection)
    } else if (currentSection) {
      if (TOP_LEVEL_TAGS.has(tag[0])) return undefined
      currentSection.push(tag)
    } else if (SECTION_TAGS.has(tag[0])) {
      return undefined
    }
  }
  if (rawSections.length === 0) return undefined
  const sections = rawSections.map(parseSection)
  if (sections.some(section => !section)) return undefined
  const parsedSections = sections as CommunitySectionV2[]
  const sectionNames = new Set<string>()
  const sectionKinds = new Set<string>()
  for (const section of parsedSections) {
    const nameKey = section.name.replace(/[A-Z]/g, value => value.toLowerCase())
    if (sectionNames.has(nameKey)) return undefined
    sectionNames.add(nameKey)
    for (const item of section.kinds) {
      const key = `${item.kind}:${item.subtype || ""}`
      if (sectionKinds.has(key)) return undefined
      sectionKinds.add(key)
    }
  }

  const pointer = makeCommunityPointer({controllerPubkey, communityId, relayHints: relays})
  if (!pointer) return undefined

  return {
    event,
    pointer,
    communityId,
    controllerPubkey,
    metadata: {
      name,
      ...(description ? {description} : {}),
      ...(picture ? {picture} : {}),
      ...(banner ? {banner} : {}),
      ...(website ? {website} : {}),
      ...(location ? {location} : {}),
      ...(geohash ? {geohash} : {}),
    },
    relays,
    blossomServers,
    graspServers,
    mints,
    ...(terms ? {terms} : {}),
    services,
    sections: parsedSections,
    sourceTags: tags.map(tag => [...tag]),
  }
}

const requireText = (value: string, minimum: number, maximum: number, label: string) => {
  const parsed = parseBoundedText(value, minimum, maximum)
  if (!parsed) throw new Error(`Invalid ${label}.`)
  return parsed
}

const makeSectionTags = (section: CommunitySectionInputV2): string[][] => {
  const tags: string[][] = [["content", requireText(section.name, 1, 100, "section name")]]
  if (section.kinds.length === 0 || section.profileLists.length === 0) {
    throw new Error("Community sections require kinds and profile lists.")
  }

  for (const item of section.kinds) {
    if (!Number.isInteger(item.kind) || item.kind < 0 || item.kind > 65535) {
      throw new Error("Invalid section kind.")
    }
    const subtype = item.subtype !== undefined ? parseBoundedText(item.subtype, 1, 64) : undefined
    if (item.subtype !== undefined && !subtype) throw new Error("Invalid section subtype.")
    tags.push(subtype ? ["k", String(item.kind), subtype] : ["k", String(item.kind)])
  }
  for (const item of section.profileLists) {
    const ref = parseAddress(item.address, 30000)
    if (!ref) throw new Error("Invalid profile-list address.")
    const relay = item.relay ? normalizeCommunityRelayV2(item.relay) : undefined
    if (item.relay && !relay) throw new Error("Invalid profile-list relay.")
    tags.push(relay ? ["a", ref.address, relay] : ["a", ref.address])
  }
  for (const item of section.badges || []) {
    const ref = parseAddress(item.address, 30009)
    if (!ref) throw new Error("Invalid badge address.")
    const relay = item.relay ? normalizeCommunityRelayV2(item.relay) : undefined
    if (item.relay && !relay) throw new Error("Invalid badge relay.")
    tags.push(relay ? ["badge", ref.address, relay] : ["badge", ref.address])
  }
  for (const item of section.retention || []) {
    if (
      !Number.isInteger(item.kind) ||
      item.kind < 0 ||
      item.kind > 65535 ||
      !Number.isSafeInteger(item.value) ||
      item.value <= 0 ||
      (item.type !== "time" && item.type !== "count")
    ) {
      throw new Error("Invalid retention policy.")
    }
    tags.push(["retention", String(item.kind), String(item.value), item.type])
  }
  return tags
}

export const buildCommunityDefinitionV2 = (
  params: BuildCommunityDefinitionV2Params,
): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND_V2} => {
  const communityId = parseCommunityId(params.communityId)
  if (!communityId) throw new Error("Invalid community ID.")
  if (params.relays.length > 20) throw new Error("Too many community relays.")
  const relays = normalizeRelayList(params.relays, 20)
  if (
    relays.length === 0 ||
    params.relays.some(value => normalizeCommunityRelayV2(value) !== value)
  ) {
    throw new Error("A valid normalized community relay is required.")
  }
  if (params.sections.length === 0) throw new Error("A community section is required.")

  const tags: string[][] = [
    ["d", communityId],
    ["name", requireText(params.name, 1, 100, "community name")],
  ]
  if (params.description) {
    tags.push(["description", requireText(params.description, 1, 4096, "description")])
  }
  for (const [name, value, normalizer] of [
    ["picture", params.picture, normalizeHttpsUrl],
    ["banner", params.banner, normalizeHttpsUrl],
    ["website", params.website, normalizeWebsite],
  ] as const) {
    if (!value) continue
    const normalized = normalizer(value)
    if (!normalized) throw new Error(`Invalid ${name}.`)
    tags.push([name, normalized])
  }
  if (params.location) {
    tags.push(["location", requireText(params.location, 1, 256, "location")])
  }
  if (params.geohash) {
    if (!GEOHASH.test(params.geohash)) throw new Error("Invalid geohash.")
    tags.push(["g", params.geohash])
  }
  for (const relay of relays) tags.push(["r", relay])
  if ((params.blossomServers?.length || 0) > 20) throw new Error("Too many Blossom URLs.")
  const blossomServers = new Set<string>()
  for (const value of params.blossomServers || []) {
    const normalized = normalizeHttpsUrl(value)
    if (!normalized || normalized !== value) throw new Error("Invalid Blossom URL.")
    if (blossomServers.has(normalized)) continue
    blossomServers.add(normalized)
    tags.push(["blossom", normalized])
  }
  if ((params.graspServers?.length || 0) > 20) throw new Error("Too many GRASP URLs.")
  const graspServers = new Set<string>()
  for (const value of params.graspServers || []) {
    const normalized = normalizeCommunityRelayV2(value)
    if (!normalized || normalized !== value) throw new Error("Invalid GRASP URL.")
    if (graspServers.has(normalized)) continue
    graspServers.add(normalized)
    tags.push(["grasp", normalized])
  }
  if ((params.mints?.length || 0) > 20) throw new Error("Too many mint declarations.")
  const mintKeys = new Set<string>()
  for (const mint of params.mints || []) {
    const url = normalizeHttpsUrl(mint.url)
    if (!url || url !== mint.url || (mint.type && !MINT_TYPE.test(mint.type))) {
      throw new Error("Invalid mint declaration.")
    }
    const key = `${url}\u0000${mint.type || ""}`
    if (mintKeys.has(key)) continue
    mintKeys.add(key)
    tags.push(mint.type ? ["mint", url, mint.type] : ["mint", url])
  }
  if (params.terms) {
    const relay = params.terms.relay ? normalizeCommunityRelayV2(params.terms.relay) : undefined
    if (
      !parseReference(params.terms.reference) ||
      (params.terms.relay && (!relay || relay !== params.terms.relay))
    ) {
      throw new Error("Invalid terms reference.")
    }
    tags.push(relay ? ["tos", params.terms.reference, relay] : ["tos", params.terms.reference])
  }
  if ((params.services?.length || 0) > 50) throw new Error("Too many service declarations.")
  const serviceKeys = new Set<string>()
  for (const service of params.services || []) {
    const pubkey = parseControllerPubkey(service.pubkey)
    const requestRelay = normalizeCommunityRelayV2(service.requestRelay)
    const handler = parseAddress(service.handlerAddress)
    const handlerRelay = normalizeCommunityRelayV2(service.handlerRelay)
    if (
      !SERVICE_NAME.test(service.name) ||
      !pubkey ||
      !requestRelay ||
      requestRelay !== service.requestRelay ||
      !handler ||
      !handlerRelay ||
      handlerRelay !== service.handlerRelay
    ) {
      throw new Error("Invalid service declaration.")
    }
    const tag = ["service", service.name, pubkey, requestRelay, handler.address, handlerRelay]
    const key = tag.join("\u0000")
    if (serviceKeys.has(key)) continue
    serviceKeys.add(key)
    tags.push(tag)
  }
  const sectionNames = new Set<string>()
  const sectionKinds = new Set<string>()
  for (const item of params.sections) {
    const name = requireText(item.name, 1, 100, "section name")
    const nameKey = name.replace(/[A-Z]/g, value => value.toLowerCase())
    if (sectionNames.has(nameKey)) throw new Error("Duplicate community section.")
    sectionNames.add(nameKey)
    for (const kind of item.kinds) {
      const key = `${kind.kind}:${kind.subtype || ""}`
      if (sectionKinds.has(key)) throw new Error("Duplicate community section kind.")
      sectionKinds.add(key)
    }
  }
  for (const item of params.sections) tags.push(...makeSectionTags(item))

  return {kind: COMMUNITY_DEFINITION_KIND_V2, content: "", tags}
}

const EDITABLE_SINGLETONS = new Set([
  "name",
  "description",
  "picture",
  "banner",
  "website",
  "location",
  "g",
])

export const updateCommunityDefinitionV2 = (
  definition: CommunityDefinitionV2,
  changes: Partial<CommunityMetadataV2>,
  options: {
    replacement?: EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND_V2}
    originalSectionNames?: Record<string, string>
  } = {},
): EventContent & {kind: typeof COMMUNITY_DEFINITION_KIND_V2} => {
  const replacements = new Map<string, string[]>()
  const metadata = {...definition.metadata, ...changes}
  replacements.set("name", ["name", requireText(metadata.name, 1, 100, "community name")])
  for (const [name, value, normalizer] of [
    ["description", metadata.description, (item: string) => parseBoundedText(item, 1, 4096)],
    ["picture", metadata.picture, normalizeHttpsUrl],
    ["banner", metadata.banner, normalizeHttpsUrl],
    ["website", metadata.website, normalizeWebsite],
    ["location", metadata.location, (item: string) => parseBoundedText(item, 1, 256)],
    ["g", metadata.geohash, (item: string) => (GEOHASH.test(item) ? item : undefined)],
  ] as const) {
    if (!value) continue
    const normalized = normalizer(value)
    if (!normalized) throw new Error(`Invalid ${name}.`)
    replacements.set(name, [name, normalized])
  }

  const seen = new Set<string>()
  const tags: string[][] = []
  for (const tag of definition.sourceTags) {
    if (!EDITABLE_SINGLETONS.has(tag[0])) {
      tags.push([...tag])
      continue
    }
    if (seen.has(tag[0])) continue
    seen.add(tag[0])
    const replacement = replacements.get(tag[0])
    if (replacement) tags.push(replacement)
  }
  for (const [name, tag] of replacements) {
    if (!seen.has(name)) tags.splice(1, 0, tag)
  }

  if (!options.replacement) {
    return {kind: COMMUNITY_DEFINITION_KIND_V2, content: "", tags}
  }

  const replacementCommunityIds = getTags(options.replacement.tags, "d")
  if (
    replacementCommunityIds.length !== 1 ||
    !exactTag(replacementCommunityIds[0], 2) ||
    replacementCommunityIds[0][1] !== definition.communityId
  ) {
    throw new Error("Community updates must preserve the exact definition address.")
  }

  const topLevelExtensions: string[][] = []
  const sectionExtensions = new Map<string, string[][]>()
  let sourceSectionName = ""
  for (const tag of tags) {
    if (tag[0] === "content") {
      sourceSectionName = tag[1].toLowerCase()
      continue
    }
    if (TOP_LEVEL_TAGS.has(tag[0]) || SECTION_TAGS.has(tag[0])) continue
    if (sourceSectionName) {
      sectionExtensions.set(sourceSectionName, [
        ...(sectionExtensions.get(sourceSectionName) || []),
        [...tag],
      ])
    } else {
      topLevelExtensions.push([...tag])
    }
  }

  const mergedTags: string[][] = []
  let extensionsInserted = false
  let replacementSectionName = ""
  const appendSectionExtensions = () => {
    if (!replacementSectionName) return
    const originalName =
      options.originalSectionNames?.[replacementSectionName] || replacementSectionName
    mergedTags.push(...(sectionExtensions.get(originalName) || []).map(tag => [...tag]))
  }

  for (const tag of options.replacement.tags) {
    if (tag[0] === "content") {
      appendSectionExtensions()
      if (!extensionsInserted) {
        mergedTags.push(...topLevelExtensions.map(item => [...item]))
        extensionsInserted = true
      }
      replacementSectionName = tag[1].toLowerCase()
    }
    mergedTags.push([...tag])
  }
  appendSectionExtensions()
  if (!extensionsInserted) mergedTags.push(...topLevelExtensions.map(item => [...item]))

  return {kind: COMMUNITY_DEFINITION_KIND_V2, content: "", tags: mergedTags}
}

const getAddressableEventAddress = (event: TrustedEvent) => {
  const dTags = getTags(event.tags || [], "d")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2)) return undefined
  const pubkey = parseControllerPubkey(event.pubkey)
  const identifier = dTags[0][1]
  if (!pubkey || !identifier) return undefined
  return `${event.kind}:${pubkey}:${identifier}`
}

export const selectCurrentAddressableEvent = (
  events: TrustedEvent[],
  address: string,
  isValid: (event: TrustedEvent) => boolean = () => true,
  isAddressTombstone: (event: TrustedEvent) => boolean = event =>
    event.tags.some(tag => exactTag(tag, 2) && tag[0] === "a" && tag[1] === address),
): TrustedEvent | undefined => {
  const parsedAddress = parseAddress(address)
  if (!parsedAddress) return undefined
  const tombstone = events
    .filter(
      event =>
        event.kind === 5 && event.pubkey === parsedAddress.pubkey && isAddressTombstone(event),
    )
    .sort(
      (first, second) => second.created_at - first.created_at || first.id.localeCompare(second.id),
    )[0]
  const addressEventIds = new Set(
    events.filter(event => getAddressableEventAddress(event) === address).map(event => event.id),
  )
  const eventTombstone = events
    .filter(
      event =>
        event.kind === 5 &&
        event.pubkey === parsedAddress.pubkey &&
        event.tags.some(tag => exactTag(tag, 2) && tag[0] === "e" && addressEventIds.has(tag[1])),
    )
    .sort(
      (first, second) => second.created_at - first.created_at || first.id.localeCompare(second.id),
    )[0]

  return events
    .filter(
      event =>
        getAddressableEventAddress(event) === address &&
        isValid(event) &&
        (!eventTombstone || event.created_at > eventTombstone.created_at) &&
        (!tombstone || event.created_at > tombstone.created_at),
    )
    .sort(
      (first, second) => second.created_at - first.created_at || first.id.localeCompare(second.id),
    )[0]
}

export const selectCurrentCommunityDefinitionV2 = (
  events: TrustedEvent[],
  definitionAddress: string,
) =>
  selectCurrentAddressableEvent(
    events,
    definitionAddress,
    event => Boolean(parseCommunityDefinitionV2(event)),
    event => {
      const addresses = event.tags.filter(tag => tag[0] === "a")
      return (
        addresses.length === 1 && exactTag(addresses[0], 2) && addresses[0][1] === definitionAddress
      )
    },
  )

export const selectCurrentCommunityDefinitionsV2 = (events: TrustedEvent[]) => {
  const addresses = new Set<string>()

  for (const event of events) {
    const definition = parseCommunityDefinitionV2(event)
    if (definition) addresses.add(definition.pointer.address)
  }

  const definitions = new Map<string, CommunityDefinitionV2>()
  for (const address of addresses) {
    const event = selectCurrentCommunityDefinitionV2(events, address)
    const definition = event ? parseCommunityDefinitionV2(event) : undefined
    if (definition) definitions.set(address, definition)
  }

  return definitions
}

export const selectCurrentTargetedPublicationEventsV2 = (events: TrustedEvent[]) => {
  const addresses = new Set<string>()
  for (const event of events) {
    if (event.kind !== TARGETED_PUBLICATION_KIND_V2) continue
    const address = getAddressableEventAddress(event)
    if (address) addresses.add(address)
  }

  return Array.from(addresses)
    .map(address =>
      selectCurrentAddressableEvent(
        events,
        address,
        event => Boolean(parseTargetedPublicationV2(event)),
        event => {
          const tags = event.tags.filter(tag => tag[0] === "a")
          return tags.length === 1 && exactTag(tags[0], 2) && tags[0][1] === address
        },
      ),
    )
    .filter((event): event is TrustedEvent => Boolean(event))
}

export const makeTargetedPublicationLifecycleFiltersV2 = (events: TrustedEvent[]): Filter[] => {
  const filters: Filter[] = []
  const ids: string[] = []
  const addresses: string[] = []

  for (const event of events) {
    if (event.kind !== TARGETED_PUBLICATION_KIND_V2) continue
    const address = getAddressableEventAddress(event)
    if (!address || addresses.includes(address)) continue
    const [, author, ...identifierParts] = address.split(":")
    filters.push({
      kinds: [TARGETED_PUBLICATION_KIND_V2],
      authors: [author],
      "#d": [identifierParts.join(":")],
    })
    addresses.push(address)
  }
  for (const event of events) {
    if (event.kind === TARGETED_PUBLICATION_KIND_V2 && event.id && !ids.includes(event.id))
      ids.push(event.id)
  }
  const authors = Array.from(new Set(addresses.map(address => address.split(":")[1])))
  if (authors.length && ids.length) filters.push({kinds: [5], authors, "#e": ids})
  if (authors.length && addresses.length) filters.push({kinds: [5], authors, "#a": addresses})

  return filters
}

const makeSourceTag = (source: TargetedPublicationSourceV2) => {
  const relay = source.relay ? normalizeCommunityRelayV2(source.relay) : undefined
  if (source.relay && !relay) throw new Error("Invalid source relay.")
  if (source.type === "a") {
    if (!parseAddress(source.value)) throw new Error("Invalid source address.")
    return ["a", source.value, relay || "", "source"]
  }
  if (!LOWER_HEX_64.test(source.value)) throw new Error("Invalid source event ID.")
  if (source.pubkey && !parseControllerPubkey(source.pubkey))
    throw new Error("Invalid source author.")
  return ["e", source.value, relay || "", source.pubkey || "", "source"]
}

export const buildTargetedPublicationV2 = ({
  id,
  kind,
  source,
  communities,
}: TargetedPublicationV2): TargetedPublicationTemplateV2 => {
  if (!id || !Number.isInteger(kind) || kind < 0 || kind > 65535) {
    throw new Error("Invalid targeted publication.")
  }
  if (communities.length < 1 || communities.length > MAX_TARGET_COMMUNITIES_V2) {
    throw new Error("A targeted publication requires 1 to 12 communities.")
  }

  const tags: string[][] = [["d", id]]
  if (source) tags.push(makeSourceTag(source))
  tags.push(["k", String(kind)])
  const addresses = new Set<string>()
  for (const community of communities) {
    const pointer = makeCommunityPointer({
      controllerPubkey: community.controllerPubkey,
      communityId: community.communityId,
      relayHints: community.relayHints,
    })
    if (!pointer || pointer.address !== community.address || pointer.naddr !== community.naddr) {
      throw new Error("Incoherent community target.")
    }
    if (addresses.has(pointer.address)) throw new Error("Duplicate community target.")
    addresses.add(pointer.address)
    tags.push(["h", pointer.communityId])
    tags.push(["a", pointer.address, pointer.relayHints[0] || "", "community"])
  }
  return {kind: TARGETED_PUBLICATION_KIND_V2, content: "", tags}
}

export const parseTargetedPublicationV2 = (
  event: TrustedEvent,
): TargetedPublicationV2 | undefined => {
  if (event.kind !== TARGETED_PUBLICATION_KIND_V2 || event.content !== "") return undefined
  const tags = event.tags || []
  if (
    tags.some(
      tag =>
        (tag[0] === "a" && tag[3] === "source" && !exactTag(tag, 4)) ||
        (tag[0] === "e" && tag[4] === "source" && !exactTag(tag, 5)) ||
        (tag[0] === "a" && tag[3] === "community" && !exactTag(tag, 4)),
    )
  ) {
    return undefined
  }
  const dTags = getTags(tags, "d")
  const kTags = getTags(tags, "k")
  if (dTags.length !== 1 || !exactTag(dTags[0], 2) || !dTags[0][1]) return undefined
  if (kTags.length !== 1 || !exactTag(kTags[0], 2)) return undefined
  const kind = parseCanonicalKind(kTags[0][1])
  if (kind === undefined) return undefined

  const sourceTags = tags.filter(
    tag => (tag[0] === "a" && tag[3] === "source") || (tag[0] === "e" && tag[4] === "source"),
  )
  if (sourceTags.length > 1) return undefined
  let source: TargetedPublicationSourceV2 | undefined
  if (sourceTags[0]?.[0] === "a") {
    const tag = sourceTags[0]
    if (!exactTag(tag, 4) || !parseAddress(tag[1])) return undefined
    const relay = tag[2] ? normalizeCommunityRelayV2(tag[2]) : undefined
    if (tag[2] && (!relay || relay !== tag[2])) return undefined
    source = {type: "a", value: tag[1], ...(relay ? {relay} : {})}
  } else if (sourceTags[0]?.[0] === "e") {
    const tag = sourceTags[0]
    if (!exactTag(tag, 5) || !LOWER_HEX_64.test(tag[1])) return undefined
    const relay = tag[2] ? normalizeCommunityRelayV2(tag[2]) : undefined
    const pubkey = tag[3] ? parseControllerPubkey(tag[3]) : undefined
    if ((tag[2] && (!relay || relay !== tag[2])) || (tag[3] && !pubkey)) return undefined
    source = {
      type: "e",
      value: tag[1],
      ...(relay ? {relay} : {}),
      ...(pubkey ? {pubkey} : {}),
    }
  }

  const communities: CommunityPointer[] = []
  const addresses = new Set<string>()
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag[0] === "a" && tag[3] === "community") {
      if (index === 0 || tags[index - 1][0] !== "h") return undefined
      continue
    }
    if (tag[0] !== "h") continue
    if (!exactTag(tag, 2)) return undefined
    const next = tags[index + 1]
    if (!next || next[0] !== "a" || next[3] !== "community" || !exactTag(next, 4)) {
      return undefined
    }
    const id = parseCommunityId(tag[1] || "")
    const addressPointer = parseCommunityDefinitionAddress(next[1] || "")
    const relay = next[2] ? normalizeCommunityRelayV2(next[2]) : undefined
    if (
      !id ||
      !addressPointer ||
      addressPointer.communityId !== id ||
      (next[2] && (!relay || relay !== next[2]))
    ) {
      return undefined
    }
    if (addresses.has(addressPointer.address)) return undefined
    addresses.add(addressPointer.address)
    communities.push(
      makeCommunityPointer({
        controllerPubkey: addressPointer.controllerPubkey,
        communityId: id,
        relayHints: relay ? [relay] : [],
      })!,
    )
    index += 1
  }
  if (communities.length < 1 || communities.length > MAX_TARGET_COMMUNITIES_V2) return undefined
  return {id: dTags[0][1], kind, ...(source ? {source} : {}), communities}
}

export const removeTargetedCommunityV2 = (event: TrustedEvent, definitionAddress: string) => {
  const parsed = parseTargetedPublicationV2(event)
  if (!parsed) return undefined
  if (parsed.communities.length === 1) return undefined
  const tags = event.tags.map(tag => [...tag])
  const index = tags.findIndex(
    (tag, itemIndex) =>
      tag[0] === "h" &&
      tags[itemIndex + 1]?.[0] === "a" &&
      tags[itemIndex + 1]?.[1] === definitionAddress &&
      tags[itemIndex + 1]?.[3] === "community",
  )
  if (index < 0) return undefined
  tags.splice(index, 2)

  return {kind: TARGETED_PUBLICATION_KIND_V2, content: event.content, tags}
}
