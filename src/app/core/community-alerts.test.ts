import {describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {
  buildCommunityDefinitionV2,
  parseCommunityDefinitionV2,
  makeCommunityPointer,
  type CommunityAlertService,
} from "./community"
import type {ActiveUserCommunityRef} from "./community-membership"
import {
  COMMUNITY_ALERTS_CHANNEL,
  COMMUNITY_ALERTS_SETTINGS_DTAG,
  COMMUNITY_ALERTS_STATUS_KIND,
  COMMUNITY_ALERTS_SUBSCRIPTION_KIND,
  assertCommunityAlertProviderQueryComplete,
  buildCommunityAlertPayload,
  createCommunityAlertOperationQueue,
  decryptCommunityAlertSettingsEvent,
  defaultCommunityAlertPreferences,
  discoverCommunityAlertProviders,
  getCommunityAlertDeletionTags,
  getCommunityAlertProviderIdentityFilter,
  getCommunityAlertStatusDtag,
  getCommunityAlertStatusTags,
  getCommunityAlertSubscriptionDtag,
  getCommunityAlertSubscriptionTags,
  isCommunityAlertEligibleRef,
  normalizeCommunityAlertSettings,
  parseCommunityAlertPayload,
  parseCommunityAlertStatus,
  runCommunityAlertSaveSequence,
  selectCommunityAlertProviderIdentity,
  selectCommunityAlertStatusEvent,
  selectCommunityAlertSubscriptionEvent,
} from "./community-alerts"

const communitySecretA = generateSecretKey()
const communitySecretB = generateSecretKey()
const userSecret = generateSecretKey()
const providerSecret = generateSecretKey()
const handlerSecret = generateSecretKey()
const communityA = getPublicKey(communitySecretA)
const communityB = getPublicKey(communitySecretB)
const userPubkey = getPublicKey(userSecret)
const providerPubkey = getPublicKey(providerSecret)
const handlerPubkey = getPublicKey(handlerSecret)
const communityAddressA = makeCommunityPointer({
  controllerPubkey: communityA,
  communityId: communityA,
})!.address
const provider: CommunityAlertService = {
  servicePubkey: providerPubkey,
  requestRelay: "wss://alerts.example.com/",
  handlerAddress: `31990:${handlerPubkey}:community-alerts`,
  handlerRelay: "wss://handlers.example.com/",
}

const makeDefinition = ({
  secret,
  services,
  createdAt,
  communityId = getPublicKey(secret),
}: {
  secret: Uint8Array
  services: CommunityAlertService[]
  createdAt: number
  communityId?: string
}) => {
  const template = buildCommunityDefinitionV2({
    communityId,
    name: `Community ${communityId}`,
    relays: ["wss://community.example.com"],
    sections: [
      {
        name: "General",
        kinds: [{kind: 1111}],
        profileLists: [{address: `30000:${getPublicKey(secret)}:members`}],
      },
    ],
    services: services.map(service => ({
      name: "community-alerts",
      pubkey: service.servicePubkey,
      requestRelay: service.requestRelay.replace(/\/$/, ""),
      handlerAddress: service.handlerAddress,
      handlerRelay: service.handlerRelay.replace(/\/$/, ""),
    })),
  })

  return parseCommunityDefinitionV2(finalizeEvent({...template, created_at: createdAt}, secret))!
}

const makeRef = (
  definition: ReturnType<typeof makeDefinition>,
  roles: ActiveUserCommunityRef["roles"] = ["member"],
): ActiveUserCommunityRef => ({
  community: definition.pointer,
  definition,
  relayHints: definition.relays,
  roles,
  writableSections: [],
})

const makePayload = (overrides: Record<string, unknown> = {}) =>
  buildCommunityAlertPayload({
    community: communityAddressA,
    email: "Person@Example.com",
    locale: "en-US",
    manageUrl: "https://budabit.example.com/settings/notifications",
    intervalDays: 7,
    localTime: "09:00",
    timezone: "UTC",
    preferences: defaultCommunityAlertPreferences,
    ...overrides,
  })

describe("verified per-community alert discovery", () => {
  it("uses the latest verified definition without deduplicating providers across communities", () => {
    const older = makeDefinition({secret: communitySecretA, services: [provider], createdAt: 10})
    const replacement = {...provider, requestRelay: "wss://new-alerts.example.com/"}
    const latest = makeDefinition({
      secret: communitySecretA,
      services: [replacement],
      createdAt: 20,
    })
    const other = makeDefinition({secret: communitySecretB, services: [provider], createdAt: 30})
    const groups = discoverCommunityAlertProviders({
      communityRefs: [makeRef(older), makeRef(latest), makeRef(other)],
      activeCommunityAddress: other.pointer.address,
    })

    expect(groups).toHaveLength(2)
    expect(groups[0].communityAddress).toBe(other.pointer.address)
    expect(
      groups.find(group => group.communityAddress === latest.pointer.address)?.providers,
    ).toEqual([{...replacement, advertisingCommunityAddress: latest.pointer.address}])
    expect(
      groups.find(group => group.communityAddress === other.pointer.address)?.providers,
    ).toEqual([{...provider, advertisingCommunityAddress: other.pointer.address}])
  })

  it("does not revive a provider removed by the latest verified definition", () => {
    const older = makeDefinition({secret: communitySecretA, services: [provider], createdAt: 10})
    const latest = makeDefinition({secret: communitySecretA, services: [], createdAt: 20})

    expect(
      discoverCommunityAlertProviders({communityRefs: [makeRef(older), makeRef(latest)]}),
    ).toEqual([])
  })

  it("groups same-controller sibling definitions by exact address", () => {
    const first = makeDefinition({
      secret: communitySecretA,
      services: [provider],
      createdAt: 10,
      communityId: communityA,
    })
    const sibling = makeDefinition({
      secret: communitySecretA,
      services: [provider],
      createdAt: 20,
      communityId: communityB,
    })

    expect(
      discoverCommunityAlertProviders({communityRefs: [makeRef(first), makeRef(sibling)]}).map(
        group => group.communityAddress,
      ),
    ).toEqual([first.pointer.address, sibling.pointer.address].sort())
  })

  it("rejects invalid signatures, mismatched refs, and refs without an active role", () => {
    const definition = makeDefinition({
      secret: communitySecretA,
      services: [provider],
      createdAt: 10,
    })
    const invalid = {...definition, event: {...definition.event, sig: "0".repeat(128)}}
    const mismatched = {
      ...makeRef(definition),
      community: makeCommunityPointer({controllerPubkey: communityB, communityId: communityB})!,
    }

    expect(isCommunityAlertEligibleRef(makeRef(definition))).toBe(true)
    expect(isCommunityAlertEligibleRef(makeRef(definition, []))).toBe(false)
    expect(isCommunityAlertEligibleRef(mismatched)).toBe(false)
    expect(discoverCommunityAlertProviders({communityRefs: [makeRef(invalid)]})).toEqual([])
  })

  it("uses service-pubkey kind 0 metadata rather than handler metadata for identity", () => {
    const serviceMetadata = finalizeEvent(
      {
        kind: 0,
        created_at: 10,
        tags: [],
        content: JSON.stringify({name: "Community Mail", about: "Member alerts"}),
      },
      providerSecret,
    )
    const handlerMetadata = finalizeEvent(
      {
        kind: 31990,
        created_at: 20,
        tags: [["d", "community-alerts"]],
        content: JSON.stringify({name: "Wrong identity"}),
      },
      handlerSecret,
    )

    expect(getCommunityAlertProviderIdentityFilter(provider)).toEqual({
      kinds: [0],
      authors: [providerPubkey],
      limit: 5,
    })
    expect(
      selectCommunityAlertProviderIdentity([handlerMetadata, serviceMetadata], provider),
    ).toEqual({name: "Community Mail", about: "Member alerts", picture: ""})
  })
})

describe("dedicated encrypted community alert settings", () => {
  it("keeps same-controller sibling registrations independent by exact address", () => {
    const first = makeCommunityPointer({controllerPubkey: communityA, communityId: communityA})!
    const sibling = makeCommunityPointer({controllerPubkey: communityA, communityId: communityB})!
    const normalized = normalizeCommunityAlertSettings({
      version: 2,
      deliveryProfile: {},
      communities: {
        [first.address]: {enabled: true, provider, preferences: {}},
      },
    })

    expect(normalized.communities[first.address]?.enabled).toBe(true)
    expect(normalized.communities[sibling.address]).toBeUndefined()
  })
  it("normalizes one independent delivery profile and preserves cleanup snapshots", () => {
    const normalized = normalizeCommunityAlertSettings({
      version: 2,
      deliveryProfile: {
        email: " Person@Example.COM ",
        intervalDays: 3,
        localTime: "08:30",
        timezone: "Europe/London",
      },
      communities: {
        [communityAddressA]: {
          enabled: true,
          provider,
          pendingCleanup: [provider, provider, {servicePubkey: "bad"}],
          lastDeletionCreatedAt: 123,
          lastError: " relay unavailable ",
          preferences: {
            density: "expanded",
            engagement: {mentions: false},
            access: {publishing: false},
            moderation: {actions: false},
            highlights: {rooms: false},
          },
        },
      },
    })

    expect(COMMUNITY_ALERTS_SETTINGS_DTAG).toBe("budabit/community-alerts-settings")
    expect(normalized.deliveryProfile).toEqual({
      email: "person@example.com",
      intervalDays: 3,
      localTime: "08:30",
      timezone: "Europe/London",
    })
    expect(normalized.communities[communityAddressA]).toMatchObject({
      enabled: true,
      provider,
      pendingCleanup: [provider],
      lastDeletionCreatedAt: 123,
      lastError: "relay unavailable",
      preferences: {
        density: "expanded",
        engagement: {replies: true, mentions: false, reactions: true, zaps: true},
        access: {membership: true, publishing: false, moderatorRequests: true},
        moderation: {reports: true, actions: false},
        highlights: {rooms: false, threads: true, calendar: true, goals: true},
      },
    })
  })

  it("does not copy unversioned Git-shaped settings into the community aggregate", () => {
    expect(
      normalizeCommunityAlertSettings({
        email: "git@example.com",
        repositories: ["repo"],
        handler: {relay: "wss://handler.example.com"},
      }),
    ).toMatchObject({version: 2, deliveryProfile: {email: ""}, communities: {}})
  })

  it("decrypts settings only for the active signer", async () => {
    const event = {
      id: "settings",
      pubkey: userPubkey,
      created_at: 1,
      kind: 30078,
      tags: [["d", COMMUNITY_ALERTS_SETTINGS_DTAG]],
      content: "ciphertext",
      sig: "sig",
    } as TrustedEvent
    const decrypt = vi.fn().mockResolvedValue(
      JSON.stringify({
        version: 2,
        deliveryProfile: {email: "Person@Example.com", timezone: "UTC"},
        communities: {},
      }),
    )

    await expect(
      decryptCommunityAlertSettingsEvent({event, activePubkey: userPubkey, decrypt}),
    ).resolves.toMatchObject({deliveryProfile: {email: "person@example.com"}})
    expect(decrypt).toHaveBeenCalledWith(userPubkey, "ciphertext")
    await expect(
      decryptCommunityAlertSettingsEvent({event, activePubkey: communityA, decrypt}),
    ).rejects.toThrow("active signer")
  })

  it("ignores malformed or unsupported encrypted settings", async () => {
    const event = {
      id: "settings",
      pubkey: userPubkey,
      created_at: 1,
      kind: 30078,
      tags: [["d", COMMUNITY_ALERTS_SETTINGS_DTAG]],
      content: "ciphertext",
      sig: "sig",
    } as TrustedEvent

    for (const plaintext of [
      "not json",
      JSON.stringify(null),
      JSON.stringify([]),
      JSON.stringify({version: 1}),
      JSON.stringify({version: 3}),
    ]) {
      await expect(
        decryptCommunityAlertSettingsEvent({
          event,
          activePubkey: userPubkey,
          decrypt: vi.fn().mockResolvedValue(plaintext),
        }),
      ).resolves.toBeUndefined()
    }
  })

  it("preserves decryption failures for encrypted settings", async () => {
    const event = {
      id: "settings",
      pubkey: userPubkey,
      created_at: 1,
      kind: 30078,
      tags: [["d", COMMUNITY_ALERTS_SETTINGS_DTAG]],
      content: "ciphertext",
      sig: "sig",
    } as TrustedEvent

    await expect(
      decryptCommunityAlertSettingsEvent({
        event,
        activePubkey: userPubkey,
        decrypt: vi.fn().mockRejectedValue(new Error("decrypt failed")),
      }),
    ).rejects.toThrow("decrypt failed")
  })
})

describe("strict community alert payloads and event tags", () => {
  it("emits all 13 booleans and no handler, relay, or repository fields", () => {
    const payload = makePayload()

    expect(payload).toEqual({
      version: 1,
      channel: COMMUNITY_ALERTS_CHANNEL,
      community: communityAddressA,
      email: "person@example.com",
      locale: "en-US",
      manageUrl: "https://budabit.example.com/settings/notifications",
      cadence: {intervalDays: 7, localTime: "09:00", timezone: "UTC"},
      preferences: defaultCommunityAlertPreferences,
    })
    expect(parseCommunityAlertPayload(payload)).toEqual(payload)
    expect(JSON.stringify(payload)).not.toMatch(/handler|relay|repositor/i)
    expect(
      parseCommunityAlertPayload({...payload, handler: provider.handlerAddress}),
    ).toBeUndefined()
    expect(
      parseCommunityAlertPayload({
        ...payload,
        preferences: {
          ...payload.preferences,
          engagement: {...payload.preferences.engagement, extra: true},
        },
      }),
    ).toBeUndefined()
    expect(
      parseCommunityAlertPayload({
        ...payload,
        preferences: {
          ...payload.preferences,
          highlights: {rooms: true, threads: true, calendar: true},
        },
      }),
    ).toBeUndefined()
  })

  it("requires HTTPS management and enforces the 64 KiB UTF-8 payload limit", () => {
    expect(() => makePayload({manageUrl: "http://budabit.example.com/settings"})).toThrow("HTTPS")
    expect(() =>
      makePayload({manageUrl: `https://budabit.example.com/?value=${"x".repeat(70_000)}`}),
    ).toThrow("64 KiB")
  })

  it("builds exact subscription, per-user status, and deletion tags", () => {
    expect(COMMUNITY_ALERTS_SUBSCRIPTION_KIND).toBe(32830)
    expect(COMMUNITY_ALERTS_STATUS_KIND).toBe(32831)
    expect(getCommunityAlertSubscriptionDtag(communityAddressA)).toBe(
      `budabit/community-alerts/${communityAddressA}`,
    )
    expect(getCommunityAlertStatusDtag(communityAddressA, userPubkey)).toBe(
      `budabit/community-alerts/${communityAddressA}/${userPubkey}`,
    )
    expect(getCommunityAlertSubscriptionTags(communityAddressA, providerPubkey)).toEqual([
      ["d", `budabit/community-alerts/${communityAddressA}`],
      ["p", providerPubkey],
    ])
    expect(getCommunityAlertStatusTags(communityAddressA, userPubkey)).toEqual([
      ["d", `budabit/community-alerts/${communityAddressA}/${userPubkey}`],
      ["p", userPubkey],
    ])
    expect(
      getCommunityAlertDeletionTags({
        communityAddress: communityAddressA,
        userPubkey,
        servicePubkey: providerPubkey,
      }),
    ).toEqual([
      ["a", `32830:${userPubkey}:budabit/community-alerts/${communityAddressA}`],
      ["p", providerPubkey],
    ])
  })

  it("selects only signed events with exact tags and per-community addresses", () => {
    const subscription = finalizeEvent(
      {
        kind: COMMUNITY_ALERTS_SUBSCRIPTION_KIND,
        created_at: 10,
        tags: getCommunityAlertSubscriptionTags(communityAddressA, providerPubkey),
        content: "encrypted",
      },
      userSecret,
    )
    const status = finalizeEvent(
      {
        kind: COMMUNITY_ALERTS_STATUS_KIND,
        created_at: 10,
        tags: getCommunityAlertStatusTags(communityAddressA, userPubkey),
        content: "encrypted",
      },
      providerSecret,
    )
    const extra = finalizeEvent(
      {...subscription, created_at: 20, tags: [...subscription.tags, ["x", "no"]]},
      userSecret,
    )

    expect(
      selectCommunityAlertSubscriptionEvent(
        [extra, subscription],
        communityAddressA,
        userPubkey,
        provider,
      ),
    ).toEqual(subscription)
    expect(
      selectCommunityAlertStatusEvent([status], communityAddressA, userPubkey, provider),
    ).toEqual(status)
    expect(
      selectCommunityAlertStatusEvent(
        [status],
        makeCommunityPointer({controllerPubkey: communityB, communityId: communityB})!.address,
        userPubkey,
        provider,
      ),
    ).toBeUndefined()
  })

  it("accepts ineligible as provider state but not as a summary status value", () => {
    const status = {
      version: 1,
      channel: COMMUNITY_ALERTS_CHANNEL,
      status: "inactive",
      state: "ineligible",
      message: "Membership ended",
      emailConfirmed: true,
      nextRunAt: null,
      lastCompletedAt: null,
    } as const

    expect(parseCommunityAlertStatus(status)).toEqual(status)
    expect(parseCommunityAlertStatus({...status, status: "ineligible"})).toBeUndefined()
  })
})

describe("community alert lifecycle sequencing", () => {
  it("serializes operations for one community without blocking other communities", async () => {
    const queue = createCommunityAlertOperationQueue()
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const blocked = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const first = queue("community-a", async () => {
      order.push("a1-start")
      await blocked
      order.push("a1-end")
    })
    const second = queue("community-a", async () => {
      order.push("a2")
    })
    const other = queue("community-b", async () => {
      order.push("b")
    })

    await other
    expect(order).toEqual(["a1-start", "b"])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["a1-start", "b", "a1-end", "a2"])
  })

  it("deletes and persists the old endpoint before registering the new provider", async () => {
    const order: string[] = []
    await runCommunityAlertSaveSequence({
      switchingProvider: true,
      persistPending: async () => void order.push("persist-pending"),
      deleteOldProvider: async () => void order.push("delete-old"),
      persistOldProviderDeleted: async () => void order.push("persist-old-deleted"),
      publishNewRegistration: async () => void order.push("register-new"),
      persistRegistered: async () => void order.push("persist-registered"),
      persistFailure: async () => void order.push("persist-failure"),
    })

    expect(order).toEqual([
      "persist-pending",
      "delete-old",
      "persist-old-deleted",
      "register-new",
      "persist-registered",
    ])
  })

  it("retains cleanup failure state and never registers the new endpoint after delete fails", async () => {
    const order: string[] = []
    await expect(
      runCommunityAlertSaveSequence({
        switchingProvider: true,
        persistPending: async () => void order.push("persist-pending"),
        deleteOldProvider: async () => {
          order.push("delete-old")
          throw new Error("old relay unavailable")
        },
        persistOldProviderDeleted: async () => void order.push("persist-old-deleted"),
        publishNewRegistration: async () => void order.push("register-new"),
        persistRegistered: async () => void order.push("persist-registered"),
        persistFailure: async phase => void order.push(`persist-${phase}-failure`),
      }),
    ).rejects.toThrow("old relay unavailable")
    expect(order).toEqual(["persist-pending", "delete-old", "persist-cleanup-failure"])
  })

  it("persists registration failure state after old-provider cleanup", async () => {
    const order: string[] = []
    await expect(
      runCommunityAlertSaveSequence({
        switchingProvider: true,
        persistPending: async () => void order.push("persist-pending"),
        deleteOldProvider: async () => void order.push("delete-old"),
        persistOldProviderDeleted: async () => void order.push("persist-old-deleted"),
        publishNewRegistration: async () => {
          order.push("register-new")
          throw new Error("new relay unavailable")
        },
        persistRegistered: async () => void order.push("persist-registered"),
        persistFailure: async phase => void order.push(`persist-${phase}-failure`),
      }),
    ).rejects.toThrow("new relay unavailable")
    expect(order).toEqual([
      "persist-pending",
      "delete-old",
      "persist-old-deleted",
      "register-new",
      "persist-registration-failure",
    ])
  })
})

describe("authenticated provider query completion", () => {
  it("requires authentication and EOSE", () => {
    expect(() =>
      assertCommunityAlertProviderQueryComplete({
        authenticated: true,
        eose: true,
        timedOut: false,
        disconnected: false,
      }),
    ).not.toThrow()
    expect(() =>
      assertCommunityAlertProviderQueryComplete({
        authenticated: false,
        eose: true,
        timedOut: false,
        disconnected: false,
      }),
    ).toThrow("authentication")
    expect(() =>
      assertCommunityAlertProviderQueryComplete({
        authenticated: true,
        eose: false,
        timedOut: false,
        disconnected: false,
      }),
    ).toThrow("before EOSE")
  })
})
