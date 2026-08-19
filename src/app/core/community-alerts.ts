import {parseJson} from "@welshman/lib"
import type {TrustedEvent} from "@welshman/util"
import {verifyEvent} from "nostr-tools/pure"
import {
  COMMUNITY_DEFINITION_KIND,
  getCommunityAlertServiceDescriptorKey,
  normalizeCommunityAlertService,
  normalizePubkey,
  parseCommunityDefinitionAddress,
  parseCommunityDefinition,
  type CommunityAlertService,
  type CommunityDefinition,
} from "@app/core/community"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  getDefaultEmailDigestTimezone,
  isEmailDigestTimezone,
  normalizeEmailDigestEmail,
  normalizeEmailDigestIntervalDays,
  normalizeEmailDigestLocale,
  normalizeEmailDigestLocalTime,
  normalizeEmailDigestTimezone,
} from "@app/core/email-digest"

export const COMMUNITY_ALERTS_CHANNEL = "community-alerts"
export const COMMUNITY_ALERTS_SUBSCRIPTION_KIND = 32830
export const COMMUNITY_ALERTS_STATUS_KIND = 32831
export const COMMUNITY_ALERTS_SETTINGS_KIND = 30078
export const COMMUNITY_ALERTS_SETTINGS_DTAG = "budabit/community-alerts-settings"
export const COMMUNITY_ALERTS_DTAG_PREFIX = "budabit/community-alerts"
export const COMMUNITY_ALERTS_MAX_PAYLOAD_BYTES = 64 * 1024

export type CommunityAlertDeliveryProfile = {
  email: string
  intervalDays: number
  localTime: string
  timezone: string
}

export type CommunityAlertDensity = "compact" | "expanded"

export type CommunityAlertPreferences = {
  density: CommunityAlertDensity
  engagement: {
    replies: boolean
    mentions: boolean
    reactions: boolean
    zaps: boolean
  }
  access: {
    membership: boolean
    publishing: boolean
    moderatorRequests: boolean
  }
  moderation: {
    reports: boolean
    actions: boolean
  }
  highlights: {
    rooms: boolean
    threads: boolean
    calendar: boolean
    goals: boolean
  }
}

export type CommunityAlertRegistration = {
  enabled: boolean
  provider?: CommunityAlertService
  pendingProvider?: CommunityAlertService
  pendingCleanup?: CommunityAlertService[]
  lastDeletionCreatedAt?: number
  preferences: CommunityAlertPreferences
  lastError?: string
}

export type CommunityAlertSettings = {
  version: 2
  deliveryProfile: CommunityAlertDeliveryProfile
  communities: Record<string, CommunityAlertRegistration>
}

export type CommunityAlertPayload = {
  version: 1
  channel: typeof COMMUNITY_ALERTS_CHANNEL
  community: string
  email: string
  locale?: string
  manageUrl: string
  cadence: {
    intervalDays: number
    localTime: string
    timezone: string
  }
  preferences: CommunityAlertPreferences
}

export type CommunityAlertStatusValue = "pending" | "ok" | "inactive" | "error"
export type CommunityAlertState =
  | "pending"
  | "active"
  | "unsubscribed"
  | "suppressed"
  | "deleted"
  | "ineligible"
  | "error"

export type CommunityAlertStatus = {
  version: 1
  channel: typeof COMMUNITY_ALERTS_CHANNEL
  status: CommunityAlertStatusValue
  state: CommunityAlertState
  message: string
  emailConfirmed: boolean
  nextRunAt: number | null
  lastCompletedAt: number | null
}

export type CommunityAlertProvider = CommunityAlertService & {
  advertisingCommunityAddress: string
}

export type CommunityAlertProviderGroup = {
  communityAddress: string
  definition: CommunityDefinition
  providers: CommunityAlertProvider[]
}

export type CommunityAlertProviderIdentity = {
  name: string
  about: string
  picture: string
}

export type CommunityAlertProviderQueryCompletion = {
  authenticated: boolean
  eose: boolean
  timedOut: boolean
  closedReason?: string
  disconnected: boolean
}

const statusValues = new Set<CommunityAlertStatusValue>(["pending", "inactive", "ok", "error"])
const stateValues = new Set<CommunityAlertState>([
  "pending",
  "active",
  "unsubscribed",
  "suppressed",
  "deleted",
  "ineligible",
  "error",
])
const statusKeys = [
  "channel",
  "emailConfirmed",
  "lastCompletedAt",
  "message",
  "nextRunAt",
  "state",
  "status",
  "version",
]
const payloadKeys = [
  "cadence",
  "channel",
  "community",
  "email",
  "manageUrl",
  "preferences",
  "version",
]
const payloadKeysWithLocale = [...payloadKeys, "locale"].sort()
const cadenceKeys = ["intervalDays", "localTime", "timezone"]
const preferenceKeys = ["access", "density", "engagement", "highlights", "moderation"]
const engagementPreferenceKeys = ["replies", "mentions", "reactions", "zaps"] as const
const accessPreferenceKeys = ["membership", "publishing", "moderatorRequests"] as const
const moderationPreferenceKeys = ["reports", "actions"] as const
const highlightPreferenceKeys = ["rooms", "threads", "calendar", "goals"] as const

const verifyEventSignature = (event: TrustedEvent) => {
  if (!event.sig) return false

  try {
    return verifyEvent({
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    })
  } catch {
    return false
  }
}

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

const hasExactTags = (actual: string[][], expected: string[][]) =>
  JSON.stringify(actual) === JSON.stringify(expected)

const selectLatest = (events: TrustedEvent[]) =>
  [...events].sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]

export const defaultCommunityAlertDeliveryProfile: CommunityAlertDeliveryProfile = {
  email: "",
  intervalDays: 7,
  localTime: "09:00",
  timezone: getDefaultEmailDigestTimezone(),
}

export const defaultCommunityAlertPreferences: CommunityAlertPreferences = {
  density: "compact",
  engagement: {replies: true, mentions: true, reactions: true, zaps: true},
  access: {membership: true, publishing: true, moderatorRequests: true},
  moderation: {reports: true, actions: true},
  highlights: {rooms: true, threads: true, calendar: true, goals: true},
}

const copyCommunityAlertPreferences = (
  preferences: CommunityAlertPreferences,
): CommunityAlertPreferences => ({
  density: preferences.density,
  engagement: {...preferences.engagement},
  access: {...preferences.access},
  moderation: {...preferences.moderation},
  highlights: {...preferences.highlights},
})

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const normalizePreferenceGroup = <K extends string>(value: unknown, keys: readonly K[]) => {
  const source = asRecord(value)

  return Object.fromEntries(keys.map(key => [key, source[key] !== false])) as Record<K, boolean>
}

export const normalizeCommunityAlertPreferences = (value: unknown): CommunityAlertPreferences => {
  const source = asRecord(value)

  return {
    density: source.density === "expanded" ? "expanded" : "compact",
    engagement: normalizePreferenceGroup(source.engagement, engagementPreferenceKeys),
    access: normalizePreferenceGroup(source.access, accessPreferenceKeys),
    moderation: normalizePreferenceGroup(source.moderation, moderationPreferenceKeys),
    highlights: normalizePreferenceGroup(source.highlights, highlightPreferenceKeys),
  }
}

export const normalizeCommunityAlertDeliveryProfile = (
  value: unknown,
): CommunityAlertDeliveryProfile => {
  const source = asRecord(value)

  return {
    email: normalizeEmailDigestEmail(source.email),
    intervalDays: normalizeEmailDigestIntervalDays(source.intervalDays),
    localTime: normalizeEmailDigestLocalTime(source.localTime),
    timezone: normalizeEmailDigestTimezone(source.timezone),
  }
}

const normalizeProviderList = (value: unknown) => {
  const result: CommunityAlertService[] = []
  const seen = new Set<string>()

  for (const candidate of Array.isArray(value) ? value : []) {
    const provider = normalizeCommunityAlertService((candidate || {}) as CommunityAlertService)
    const key = provider ? getCommunityAlertServiceDescriptorKey(provider) : ""
    if (!provider || !key || seen.has(key)) continue
    seen.add(key)
    result.push(provider)
  }

  return result
}

export const normalizeCommunityAlertRegistration = (value: unknown): CommunityAlertRegistration => {
  const source = asRecord(value)
  const provider = normalizeCommunityAlertService((source.provider || {}) as CommunityAlertService)
  const pendingProvider = normalizeCommunityAlertService(
    (source.pendingProvider || {}) as CommunityAlertService,
  )
  const pendingCleanup = normalizeProviderList(source.pendingCleanup)
  const lastDeletionCreatedAt =
    typeof source.lastDeletionCreatedAt === "number" &&
    Number.isSafeInteger(source.lastDeletionCreatedAt) &&
    source.lastDeletionCreatedAt > 0
      ? source.lastDeletionCreatedAt
      : undefined
  const lastError =
    typeof source.lastError === "string" ? source.lastError.trim().slice(0, 500) : ""

  return {
    enabled: source.enabled === true && Boolean(provider),
    ...(provider ? {provider} : {}),
    ...(pendingProvider ? {pendingProvider} : {}),
    ...(pendingCleanup.length > 0 ? {pendingCleanup} : {}),
    ...(lastDeletionCreatedAt ? {lastDeletionCreatedAt} : {}),
    preferences: normalizeCommunityAlertPreferences(source.preferences),
    ...(lastError ? {lastError} : {}),
  }
}

export const defaultCommunityAlertSettings: CommunityAlertSettings = {
  version: 2,
  deliveryProfile: defaultCommunityAlertDeliveryProfile,
  communities: {},
}

export const normalizeCommunityAlertSettings = (value: unknown): CommunityAlertSettings => {
  const source = asRecord(value)
  if (source.version !== 2) {
    return {
      ...defaultCommunityAlertSettings,
      deliveryProfile: {...defaultCommunityAlertDeliveryProfile},
      communities: {},
    }
  }

  const rawCommunities = asRecord(source.communities)
  const communities: Record<string, CommunityAlertRegistration> = {}
  for (const [rawAddress, registration] of Object.entries(rawCommunities)) {
    const community = parseCommunityDefinitionAddress(rawAddress)
    if (community) {
      communities[community.address] = normalizeCommunityAlertRegistration(registration)
    }
  }

  return {
    version: 2,
    deliveryProfile: normalizeCommunityAlertDeliveryProfile(source.deliveryProfile),
    communities,
  }
}

const isVerifiedCommunityDefinition = (definition?: CommunityDefinition) => {
  const event = definition?.event

  return Boolean(
    definition &&
    event?.kind === COMMUNITY_DEFINITION_KIND &&
    normalizePubkey(event.pubkey) === definition.ownerPubkey &&
    verifyEventSignature(event),
  )
}

export const isCommunityAlertEligibleRef = (ref: ActiveUserCommunityRef | undefined) =>
  Boolean(
    ref &&
    ref.community.address === ref.definition.pointer.address &&
    ref.roles.some(role => role === "member" || role === "moderator" || role === "admin") &&
    ref.definition.services.some(service => service.name === COMMUNITY_ALERTS_CHANNEL),
  )

export const discoverCommunityAlertProviders = ({
  communityRefs,
  activeCommunityAddress = "",
}: {
  communityRefs: ActiveUserCommunityRef[]
  activeCommunityAddress?: string
}): CommunityAlertProviderGroup[] => {
  const latestByCommunity = new Map<string, ActiveUserCommunityRef>()

  for (const ref of communityRefs) {
    if (!isVerifiedCommunityDefinition(ref.definition)) continue
    const parsed = parseCommunityDefinition(ref.definition.event)
    if (!parsed || ref.community.address !== parsed.pointer.address) continue
    const current = latestByCommunity.get(parsed.pointer.address)
    if (
      !current ||
      parsed.event.created_at > current.definition.event.created_at ||
      (parsed.event.created_at === current.definition.event.created_at &&
        parsed.event.id < current.definition.event.id)
    ) {
      latestByCommunity.set(parsed.pointer.address, {
        ...ref,
        community: parsed.pointer,
        definition: parsed,
      })
    }
  }

  const active = parseCommunityDefinitionAddress(activeCommunityAddress)?.address || ""
  return Array.from(latestByCommunity.values())
    .sort((a, b) => {
      const activeOrder =
        Number(b.community.address === active) - Number(a.community.address === active)

      return activeOrder || a.community.address.localeCompare(b.community.address)
    })
    .flatMap(ref => {
      if (!isCommunityAlertEligibleRef(ref)) return []
      const communityAddress = ref.definition.pointer.address
      const providers = ref.definition.services.flatMap(service => {
        if (service.name !== COMMUNITY_ALERTS_CHANNEL) return []
        const provider = normalizeCommunityAlertService({...service, servicePubkey: service.pubkey})

        return provider ? [{...provider, advertisingCommunityAddress: communityAddress}] : []
      })

      return providers.length > 0 ? [{communityAddress, definition: ref.definition, providers}] : []
    })
}

export const isCommunityAlertProviderAdvertised = ({
  communityAddress,
  provider,
  providerGroups,
}: {
  communityAddress: string
  provider: CommunityAlertService | undefined
  providerGroups: CommunityAlertProviderGroup[]
}) => {
  const normalizedCommunity = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  const key = provider ? getCommunityAlertServiceDescriptorKey(provider) : ""
  const group = providerGroups.find(candidate => candidate.communityAddress === normalizedCommunity)

  return Boolean(
    key &&
    group?.providers.some(candidate => getCommunityAlertServiceDescriptorKey(candidate) === key),
  )
}

export const getCommunityAlertProviderIdentityFilter = (provider: CommunityAlertService) => {
  const normalized = normalizeCommunityAlertService(provider)

  return normalized ? {kinds: [0], authors: [normalized.servicePubkey], limit: 5} : undefined
}

const identityText = (values: unknown[], maxLength: number) => {
  const value = values.find(candidate => typeof candidate === "string" && candidate.trim())

  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

const identityPicture = (value: unknown) => {
  const picture = identityText([value], 2048)
  if (!picture) return ""

  try {
    const url = new URL(picture)

    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      ? url.toString()
      : ""
  } catch {
    return ""
  }
}

export const selectCommunityAlertProviderIdentity = (
  events: TrustedEvent[],
  provider: CommunityAlertService,
): CommunityAlertProviderIdentity | undefined => {
  const normalized = normalizeCommunityAlertService(provider)
  if (!normalized) return undefined
  const event = selectLatest(
    events.filter(
      candidate =>
        candidate.kind === 0 &&
        candidate.pubkey === normalized.servicePubkey &&
        verifyEventSignature(candidate),
    ),
  )
  if (!event) return undefined
  const metadata = parseJson(event.content)
  const source = asRecord(metadata)
  const name = identityText([source.display_name, source.name], 100)
  const about = identityText([source.about], 500)
  const picture = identityPicture(source.picture || source.image)

  return name || about || picture ? {name, about, picture} : undefined
}

const normalizeManageUrl = (value: string) => {
  try {
    const url = new URL(value)

    return url.protocol === "https:" && !url.username && !url.password && !url.hash
      ? url.toString()
      : ""
  } catch {
    return ""
  }
}

const isStrictBooleanGroup = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const source = value as Record<string, unknown>

  return hasExactKeys(source, [...keys]) && keys.every(key => typeof source[key] === "boolean")
}

const isStrictPreferences = (value: unknown): value is CommunityAlertPreferences => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const source = value as Record<string, unknown>

  return (
    hasExactKeys(source, preferenceKeys) &&
    (source.density === "compact" || source.density === "expanded") &&
    isStrictBooleanGroup(source.engagement, engagementPreferenceKeys) &&
    isStrictBooleanGroup(source.access, accessPreferenceKeys) &&
    isStrictBooleanGroup(source.moderation, moderationPreferenceKeys) &&
    isStrictBooleanGroup(source.highlights, highlightPreferenceKeys)
  )
}

export const buildCommunityAlertPayload = ({
  community,
  email,
  locale,
  manageUrl,
  intervalDays,
  localTime,
  timezone,
  preferences,
}: {
  community: string
  email: string
  locale?: string
  manageUrl: string
  intervalDays: number
  localTime: string
  timezone: string
  preferences: CommunityAlertPreferences
}): CommunityAlertPayload => {
  const normalizedCommunity = parseCommunityDefinitionAddress(community)?.address || ""
  if (!normalizedCommunity) throw new Error("Community alerts require a valid community address.")
  const normalizedEmail = normalizeEmailDigestEmail(email)
  if (!normalizedEmail) throw new Error("Enter a valid delivery email address.")
  if (normalizeEmailDigestIntervalDays(intervalDays, 0) !== intervalDays) {
    throw new Error("Alert cadence must be a whole number from 1 to 30 days.")
  }
  if (normalizeEmailDigestLocalTime(localTime, "") !== localTime) {
    throw new Error("Alert delivery time must use HH:MM in 24-hour time.")
  }
  if (!isEmailDigestTimezone(timezone) || timezone.trim() !== timezone) {
    throw new Error("Enter a valid IANA timezone.")
  }
  const normalizedManageUrl = normalizeManageUrl(manageUrl)
  if (!normalizedManageUrl) throw new Error("Community alerts require an HTTPS management URL.")
  const normalizedLocale = normalizeEmailDigestLocale(locale)
  if (locale !== undefined && normalizedLocale === undefined) {
    throw new Error("Enter a valid locale of at most 64 characters.")
  }
  if (!isStrictPreferences(preferences)) {
    throw new Error("Community alert preferences are invalid.")
  }

  const payload: CommunityAlertPayload = {
    version: 1,
    channel: COMMUNITY_ALERTS_CHANNEL,
    community: normalizedCommunity,
    email: normalizedEmail,
    ...(normalizedLocale ? {locale: normalizedLocale} : {}),
    manageUrl: normalizedManageUrl,
    cadence: {intervalDays, localTime, timezone},
    preferences: copyCommunityAlertPreferences(preferences),
  }
  if (
    new TextEncoder().encode(JSON.stringify(payload)).byteLength >
    COMMUNITY_ALERTS_MAX_PAYLOAD_BYTES
  ) {
    throw new Error("Community alert configuration exceeds the 64 KiB payload limit.")
  }

  return payload
}

export const parseCommunityAlertPayload = (value: unknown): CommunityAlertPayload | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const expectedKeys = source.locale === undefined ? payloadKeys : payloadKeysWithLocale
  if (
    !hasExactKeys(source, expectedKeys) ||
    source.version !== 1 ||
    source.channel !== COMMUNITY_ALERTS_CHANNEL ||
    typeof source.community !== "string" ||
    parseCommunityDefinitionAddress(source.community)?.address !== source.community ||
    typeof source.email !== "string" ||
    normalizeEmailDigestEmail(source.email) !== source.email ||
    typeof source.manageUrl !== "string" ||
    normalizeManageUrl(source.manageUrl) !== source.manageUrl ||
    (source.locale !== undefined &&
      (typeof source.locale !== "string" ||
        normalizeEmailDigestLocale(source.locale) !== source.locale)) ||
    !source.cadence ||
    typeof source.cadence !== "object" ||
    Array.isArray(source.cadence) ||
    !hasExactKeys(source.cadence as Record<string, unknown>, cadenceKeys) ||
    !isStrictPreferences(source.preferences)
  ) {
    return undefined
  }
  const cadence = source.cadence as Record<string, unknown>
  if (
    typeof cadence.intervalDays !== "number" ||
    normalizeEmailDigestIntervalDays(cadence.intervalDays, 0) !== cadence.intervalDays ||
    typeof cadence.localTime !== "string" ||
    normalizeEmailDigestLocalTime(cadence.localTime, "") !== cadence.localTime ||
    typeof cadence.timezone !== "string" ||
    !isEmailDigestTimezone(cadence.timezone) ||
    cadence.timezone.trim() !== cadence.timezone
  ) {
    return undefined
  }
  if (
    new TextEncoder().encode(JSON.stringify(source)).byteLength > COMMUNITY_ALERTS_MAX_PAYLOAD_BYTES
  ) {
    return undefined
  }

  return source as CommunityAlertPayload
}

export const getCommunityAlertSubscriptionDtag = (communityAddress: string) => {
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""

  return community ? `${COMMUNITY_ALERTS_DTAG_PREFIX}/${community}` : ""
}

export const getCommunityAlertStatusDtag = (communityAddress: string, userPubkey: string) => {
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  const user = normalizePubkey(userPubkey)

  return community && user ? `${COMMUNITY_ALERTS_DTAG_PREFIX}/${community}/${user}` : ""
}

export const getCommunityAlertSubscriptionTags = (
  communityAddress: string,
  servicePubkey: string,
) => {
  const dtag = getCommunityAlertSubscriptionDtag(communityAddress)
  const provider = normalizePubkey(servicePubkey)
  if (!dtag || !provider) throw new Error("Invalid community alert subscription tags.")

  return [
    ["d", dtag],
    ["p", provider],
  ]
}

export const getCommunityAlertStatusTags = (communityAddress: string, userPubkey: string) => {
  const dtag = getCommunityAlertStatusDtag(communityAddress, userPubkey)
  const user = normalizePubkey(userPubkey)
  if (!dtag || !user) throw new Error("Invalid community alert status tags.")

  return [
    ["d", dtag],
    ["p", user],
  ]
}

export const getCommunityAlertDeletionTags = ({
  communityAddress,
  userPubkey,
  servicePubkey,
}: {
  communityAddress: string
  userPubkey: string
  servicePubkey: string
}) => {
  const user = normalizePubkey(userPubkey)
  const provider = normalizePubkey(servicePubkey)
  const dtag = getCommunityAlertSubscriptionDtag(communityAddress)
  if (!user || !provider || !dtag) throw new Error("Invalid community alert deletion tags.")

  return [
    ["a", `${COMMUNITY_ALERTS_SUBSCRIPTION_KIND}:${user}:${dtag}`],
    ["p", provider],
  ]
}

export const selectCommunityAlertSubscriptionEvent = (
  events: TrustedEvent[],
  communityAddress: string,
  userPubkey: string,
  provider: CommunityAlertService,
) =>
  selectLatest(
    events.filter(
      event =>
        event.kind === COMMUNITY_ALERTS_SUBSCRIPTION_KIND &&
        event.pubkey === normalizePubkey(userPubkey) &&
        hasExactTags(
          event.tags,
          getCommunityAlertSubscriptionTags(communityAddress, provider.servicePubkey),
        ) &&
        verifyEventSignature(event),
    ),
  )

export const selectCommunityAlertStatusEvent = (
  events: TrustedEvent[],
  communityAddress: string,
  userPubkey: string,
  provider: CommunityAlertService,
) =>
  selectLatest(
    events.filter(
      event =>
        event.kind === COMMUNITY_ALERTS_STATUS_KIND &&
        event.pubkey === normalizePubkey(provider.servicePubkey) &&
        hasExactTags(event.tags, getCommunityAlertStatusTags(communityAddress, userPubkey)) &&
        verifyEventSignature(event),
    ),
  )

const isStatusTimestamp = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value))

export const parseCommunityAlertStatus = (value: unknown): CommunityAlertStatus | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (
    !hasExactKeys(source, statusKeys) ||
    source.version !== 1 ||
    source.channel !== COMMUNITY_ALERTS_CHANNEL ||
    !statusValues.has(source.status as CommunityAlertStatusValue) ||
    !stateValues.has(source.state as CommunityAlertState) ||
    typeof source.message !== "string" ||
    typeof source.emailConfirmed !== "boolean" ||
    !isStatusTimestamp(source.nextRunAt) ||
    !isStatusTimestamp(source.lastCompletedAt)
  ) {
    return undefined
  }

  return source as CommunityAlertStatus
}

export const decryptCommunityAlertSettingsEvent = async ({
  event,
  activePubkey,
  decrypt,
}: {
  event: TrustedEvent
  activePubkey: string
  decrypt: (pubkey: string, content: string) => Promise<string>
}) => {
  if (!activePubkey || event.pubkey !== activePubkey) {
    throw new Error("Community alert settings do not belong to the active signer.")
  }
  const plaintext = await decrypt(event.pubkey, event.content)
  const parsed = parseJson(plaintext)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 2) {
    return undefined
  }

  return normalizeCommunityAlertSettings(parsed)
}

export const assertCommunityAlertProviderQueryComplete = (
  completion: CommunityAlertProviderQueryCompletion,
) => {
  if (completion.timedOut) throw new Error("Community alert provider query timed out before EOSE.")
  if (completion.closedReason) {
    throw new Error(`Community alert provider closed the query: ${completion.closedReason}`)
  }
  if (completion.disconnected) {
    throw new Error("Community alert provider disconnected before EOSE.")
  }
  if (!completion.authenticated) {
    throw new Error("Community alert provider authentication did not complete.")
  }
  if (!completion.eose) throw new Error("Community alert provider query ended before EOSE.")
}

export const runCommunityAlertSaveSequence = async <T>({
  switchingProvider,
  persistPending,
  deleteOldProvider,
  persistOldProviderDeleted,
  publishNewRegistration,
  persistRegistered,
  persistFailure,
}: {
  switchingProvider: boolean
  persistPending: () => Promise<unknown>
  deleteOldProvider: () => Promise<unknown>
  persistOldProviderDeleted: () => Promise<unknown>
  publishNewRegistration: () => Promise<T>
  persistRegistered: () => Promise<unknown>
  persistFailure: (phase: "cleanup" | "registration", error: unknown) => Promise<unknown>
}) => {
  await persistPending()

  if (switchingProvider) {
    try {
      await deleteOldProvider()
      await persistOldProviderDeleted()
    } catch (error) {
      await persistFailure("cleanup", error)
      throw error
    }
  }

  let registration: T
  try {
    registration = await publishNewRegistration()
  } catch (error) {
    await persistFailure("registration", error)
    throw error
  }

  await persistRegistered()
  return registration
}

export const getNextCommunityAlertCreatedAt = (
  currentCreatedAt?: number,
  now = Math.floor(Date.now() / 1000),
) => Math.max(now, currentCreatedAt ? currentCreatedAt + 1 : 0)

export const createCommunityAlertOperationQueue = () => {
  const pending = new Map<string, Promise<unknown>>()

  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const operation = (pending.get(key) || Promise.resolve()).catch(() => undefined).then(run)
    pending.set(key, operation)

    const cleanup = () => {
      if (pending.get(key) === operation) pending.delete(key)
    }
    void operation.then(cleanup, cleanup)

    return operation
  }
}
