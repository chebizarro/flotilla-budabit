// @vitest-environment jsdom

import {get, readable} from "svelte/store"
import {readFileSync} from "node:fs"
import {getPublicKey, nip19} from "nostr-tools"
import {describe, expect, it, vi} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {CommunityDefinitionV2} from "@app/core/community"
import {buildTargetedPublicationV2, makeCommunityPointer} from "@app/core/community"
import type {CommunityPermissionStatus} from "@app/core/community-state"

vi.mock("@app/core/storage", () => ({
  kv: {get: vi.fn(), set: vi.fn(), clear: vi.fn()},
  db: {},
}))

vi.mock("@app/core/state", () => ({
  chatsById: readable(new Map()),
  userSettingsValues: readable({show_notifications_badge: false}),
}))

vi.mock("@app/core/community-state", () => ({
  activeExactCommunityDefinition: readable(undefined),
  activeCommunityModeratorRequestStates: readable([]),
  activeCommunityPermissionStatus: readable({
    communityPubkey: "",
    key: "",
    loading: false,
    loaded: false,
    complete: false,
    hasCachedEvents: false,
  }),
  activeCommunityProfileListEvents: readable([]),
  activeExactCommunityRelays: readable([]),
  activeCommunityReportState: readable(undefined),
  activeCommunityUserModeratorRequestStates: readable([]),
}))

const makeTestCommunity = (controllerByte: number, idByte: number) =>
  makeCommunityPointer({
    controllerPubkey: getPublicKey(new Uint8Array(32).fill(controllerByte)),
    communityId: getPublicKey(new Uint8Array(32).fill(idByte)),
  })!

vi.mock("@app/util/routes", () => ({
  makeChatPath: (id: string) => `/chat/${id}`,
  makeExactCommunityPath: (community: {naddr: string}, ...extra: string[]) =>
    `/c/${community.naddr}${extra.length ? `/${extra.join("/")}` : ""}`,
  makeExactCommunityCalendarPath: (community: {naddr: string}, event?: string) =>
    `/c/${community.naddr}/calendar${event ? `/${event}` : ""}`,
  makeExactCommunityGoalPath: (community: {naddr: string}, goal?: string) =>
    `/c/${community.naddr}/goals${goal ? `/${goal}` : ""}`,
  makeExactCommunityRoomPath: (community: {naddr: string}, room: string) =>
    `/c/${community.naddr}/rooms/${room}`,
  makeExactCommunityThreadPath: (community: {naddr: string}, thread?: string) =>
    `/c/${community.naddr}/threads${thread ? `/${thread}` : ""}`,
}))

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "b".repeat(64),
    created_at: 1,
    kind: 1111,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("notifications", () => {
  it("uses bounded structural wrapper discovery and relay-hint original plans", () => {
    const source = readFileSync("src/app/util/notifications.ts", "utf8")

    expect(source).toContain("makeCommunityContentFilterPlan(")
    expect(source).toContain("relayFilters: targetingFilterPlan.relayFilters")
    expect(source).toContain("localFilters: targetingFilterPlan.localFilters")
    expect(source).toContain("parseTargetedPublicationV2(event)")
    expect(source).not.toContain("parseTargetedPublication(")
    expect(source).toContain("makeTargetedPublicationOriginalRelayHintPlans(")
    expect(source.match(/loadBoundedCommunityHistory\(\{/g)).toHaveLength(2)
    expect(source).not.toContain("request({")
  })

  it("fails active-community candidates closed until current permissions are authoritative", async () => {
    const {getActiveCommunityNotificationPermissionKey} = await import("./notifications")
    const viewer = "a".repeat(64)
    const community = makeTestCommunity(11, 12)
    const communityPubkey = community.controllerPubkey
    const definition = {
      event: makeEvent({id: "definition", pubkey: communityPubkey}),
      pointer: community,
      controllerPubkey: community.controllerPubkey,
    } as CommunityDefinitionV2
    const ready: CommunityPermissionStatus = {
      communityPubkey,
      key: `${viewer}:definition:wss://relay.example/:1`,
      loading: false,
      loaded: true,
      complete: true,
      hasCachedEvents: true,
    }

    expect(getActiveCommunityNotificationPermissionKey(definition, viewer, ready)).toBe(ready.key)
    const regranted = {...ready, key: `${viewer}:definition:wss://relay.example/:2`}
    expect(getActiveCommunityNotificationPermissionKey(definition, viewer, regranted)).toBe(
      regranted.key,
    )
    expect(regranted.key).not.toBe(ready.key)
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        loading: true,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        loaded: false,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        complete: false,
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        communityPubkey: "c".repeat(64),
      }),
    ).toBe("")
    expect(
      getActiveCommunityNotificationPermissionKey(definition, viewer, {
        ...ready,
        key: `${"d".repeat(64)}:definition:wss://relay.example/:1`,
      }),
    ).toBe("")
  })

  it("clears and refilters candidate stores across revoke and regrant evidence", () => {
    const source = readFileSync("src/app/util/notifications.ts", "utf8")
    const roomStore = source.slice(
      source.indexOf("const roomMessageNotificationCandidates"),
      source.indexOf("const threadRootNotificationCandidates"),
    )
    const threadStore = source.slice(
      source.indexOf("const threadRootNotificationCandidates"),
      source.indexOf("const makeTargetedPublicationRootNotificationCandidates"),
    )
    const targetedStore = source.slice(
      source.indexOf("const makeTargetedPublicationRootNotificationCandidates"),
      source.indexOf("const calendarRootNotificationCandidates"),
    )

    for (const store of [roomStore, threadStore, targetedStore]) {
      expect(store).toContain("activeCommunityPermissionStatus")
      expect(store).toContain("$activeCommunityPermissionStatus")
      expect(store).toMatch(/if \(!permissionKey\) \{\s*set\(\[\]\)\s*return/)
      expect(store.indexOf("if (!permissionKey)")).toBeLessThan(
        store.indexOf("getCommunityTargetWriterPubkeys({"),
      )
    }

    expect(roomStore).toContain("authors: authorPubkeys")
    expect(threadStore).toContain("authors: authorPubkeys")
    expect(targetedStore).toContain("makeCommunityContentFilterPlan(")
    expect(targetedStore).toContain("relayFilters: targetingFilterPlan.relayFilters")
    expect(targetedStore).toContain("localFilters: targetingFilterPlan.localFilters")
    expect(targetedStore).toContain("owner: `notifications-community-targets:${permissionKey}`")
    expect(targetedStore).toContain("owner: `notifications-community-originals:${permissionKey}`")
    expect(targetedStore).toContain("getCommunityCalendarTargetWriterPubkeys({")
    expect(targetedStore).toContain("aggregateCalendarWriters")

    const calendarStore = source.slice(
      source.indexOf("const calendarRootNotificationCandidates"),
      source.indexOf("const goalRootNotificationCandidates"),
    )
    expect(calendarStore).toContain("aggregateCalendarWriters: true")
  })

  it("uses aggregate calendar admission in global notification discovery", () => {
    const source = readFileSync("src/app/util/notification-sources.ts", "utf8")
    const targetingSources = source.slice(
      source.indexOf("const globalCommunityTargetingSources"),
      source.indexOf("const globalCommunityTargetingCandidateLoad"),
    )

    expect(source).toContain("hasCommunityCalendarGrantEvidence")
    expect(targetingSources).toContain("getCommunityCalendarTargetWriterPubkeys({")
    expect(targetingSources).toContain("calendarGrantEvidenceComplete")
    expect(targetingSources).not.toContain("calendarWriterPubkeysByKind")
  })

  it("matches repo notification helpers against canonical git routes", async () => {
    const {getRepoNotificationPaths, hasRepoNotification, setCheckedForRepoNotifications} =
      await import("./notifications")
    const pubkey = "a".repeat(64)
    const identifier = "flotilla-budabit"
    const naddr = nip19.naddrEncode({kind: 30617, pubkey, identifier})
    const repoAddress = `30617:${pubkey}:${identifier}`
    const paths = new Set([`/git/${naddr}/issues`, `/git/${naddr}/prs`, "/chat/example"])

    expect(getRepoNotificationPaths(paths, {repoAddress, kind: "issues"})).toEqual([
      `/git/${naddr}/issues`,
    ])
    expect(hasRepoNotification(paths, {repoAddress})).toBe(true)
    expect(setCheckedForRepoNotifications(new Set(), {repoAddress})).toBeUndefined()
  })

  it("setupBudabitNotifications returns cleanup", async () => {
    const {setupBudabitNotifications} = await import("./notifications")

    expect(setupBudabitNotifications()).toEqual(expect.any(Function))
  })

  it("creates room notification candidates from latest incoming room messages", async () => {
    const {getRoomMessageNotificationCandidates} = await import("./notifications")
    const community = makeTestCommunity(9, 10)
    const communityPubkey = community.communityId
    const currentPubkey = "b".repeat(64)
    const incomingPubkey = "c".repeat(64)
    const bannedPubkey = "d".repeat(64)
    const roomOneOlder = makeEvent({
      id: "room-one-older",
      pubkey: incomingPubkey,
      created_at: 10,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const roomOneNewer = makeEvent({
      id: "room-one-newer",
      pubkey: incomingPubkey,
      created_at: 20,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const ownLatest = makeEvent({
      id: "own-latest",
      pubkey: currentPubkey,
      created_at: 30,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-one"],
      ],
    })
    const roomTwo = makeEvent({
      id: "room-two-message",
      pubkey: incomingPubkey,
      created_at: 15,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-two"],
      ],
    })
    const legacyLowercaseRoomTag = makeEvent({
      id: "legacy-lowercase-room-tag",
      pubkey: incomingPubkey,
      created_at: 18,
      kind: 9,
      tags: [
        ["h", nip19.npubEncode(communityPubkey)],
        ["e", "room-legacy"],
      ],
    })
    const banned = makeEvent({
      id: "banned-message",
      pubkey: bannedPubkey,
      created_at: 50,
      kind: 9,
      tags: [
        ["h", communityPubkey],
        ["E", "room-three"],
      ],
    })
    const otherCommunity = makeEvent({
      id: "other-community-message",
      pubkey: incomingPubkey,
      created_at: 40,
      kind: 9,
      tags: [
        ["h", "e".repeat(64)],
        ["E", "room-one"],
      ],
    })

    expect(
      getRoomMessageNotificationCandidates({
        events: [
          roomOneOlder,
          roomOneNewer,
          ownLatest,
          roomTwo,
          legacyLowercaseRoomTag,
          banned,
          otherCommunity,
        ],
        community,
        currentPubkey,
        allowPubkey: candidatePubkey => candidatePubkey !== bannedPubkey,
      }),
    ).toEqual([
      {path: `/c/${community.naddr}/rooms/room-one`, latestEvent: roomOneNewer},
      {path: `/c/${community.naddr}/rooms/room-two`, latestEvent: roomTwo},
    ])
  })

  it("creates section notification candidates from latest incoming root events", async () => {
    const {getSectionRootNotificationCandidates} = await import("./notifications")
    const currentPubkey = "b".repeat(64)
    const incomingPubkey = "c".repeat(64)
    const path = "/c/community/threads"
    const olderThread = makeEvent({
      id: "older-thread",
      pubkey: incomingPubkey,
      created_at: 10,
      kind: 11,
    })
    const newerThread = makeEvent({
      id: "newer-thread",
      pubkey: incomingPubkey,
      created_at: 20,
      kind: 11,
    })
    const ownThread = makeEvent({
      id: "own-thread",
      pubkey: currentPubkey,
      created_at: 30,
      kind: 11,
    })
    const comment = makeEvent({
      id: "comment",
      pubkey: incomingPubkey,
      created_at: 40,
      kind: 1111,
    })

    expect(
      getSectionRootNotificationCandidates({
        events: [olderThread, newerThread, ownThread, comment],
        path,
        currentPubkey,
        allowEvent: event => event.kind === 11,
      }),
    ).toEqual([{path, latestEvent: newerThread}])
  })

  it("matches strict V2 targets by exact branch address", async () => {
    const {getTargetedPublicationRootNotificationCandidates} = await import("./notifications")
    const controller = getPublicKey(new Uint8Array(32).fill(1))
    const siblingController = getPublicKey(new Uint8Array(32).fill(2))
    const author = getPublicKey(new Uint8Array(32).fill(3))
    const sharedId = "7".repeat(64)
    const community = makeCommunityPointer({controllerPubkey: controller, communityId: sharedId})!
    const sibling = makeCommunityPointer({
      controllerPubkey: siblingController,
      communityId: sharedId,
    })!
    const path = `/c/${community.naddr}/calendar`
    const root = makeEvent({
      id: "root",
      pubkey: author,
      created_at: 19,
      kind: 31923,
      tags: [["d", "calendar"]],
    })
    const targeted = makeEvent({
      id: "targeted",
      pubkey: author,
      created_at: 20,
      ...buildTargetedPublicationV2({
        id: "target",
        kind: 31923,
        source: {type: "a", value: `31923:${author}:calendar`},
        communities: [community],
      }),
    })
    const siblingTargeted = makeEvent({
      id: "sibling-targeted",
      pubkey: author,
      created_at: 30,
      ...buildTargetedPublicationV2({
        id: "sibling-target",
        kind: 31923,
        source: {type: "a", value: `31923:${author}:calendar`},
        communities: [sibling],
      }),
    })
    const v1Shaped = makeEvent({
      id: "v1-shaped",
      pubkey: author,
      created_at: 40,
      kind: 30222,
      tags: [
        ["d", "legacy"],
        ["k", "31923"],
        ["p", controller],
      ],
    })

    expect(
      getTargetedPublicationRootNotificationCandidates({
        targetingEvents: [targeted, siblingTargeted, v1Shaped],
        rootEvents: [root],
        communityAddress: community.address,
        path,
        kind: 31923,
      }),
    ).toEqual([{path, latestEvent: targeted}])
  })

  it("allows explicit external roots but binds implicit roots to the wrapper signer", async () => {
    const {getTargetedPublicationRootNotificationCandidates} = await import("./notifications")
    const controller = getPublicKey(new Uint8Array(32).fill(4))
    const wrapperPubkey = getPublicKey(new Uint8Array(32).fill(5))
    const externalPubkey = getPublicKey(new Uint8Array(32).fill(6))
    const community = makeCommunityPointer({
      controllerPubkey: controller,
      communityId: "8".repeat(64),
    })!
    const path = `/c/${community.naddr}/goals`
    const explicitTargeting = makeEvent({
      id: "explicit-targeting",
      pubkey: wrapperPubkey,
      created_at: 20,
      ...buildTargetedPublicationV2({
        id: "explicit-target",
        kind: 9041,
        source: {type: "e", value: "a".repeat(64), pubkey: externalPubkey},
        communities: [community],
      }),
    })
    const externalRoot = makeEvent({
      id: "a".repeat(64),
      pubkey: externalPubkey,
      created_at: 19,
      kind: 9041,
      tags: [["d", "external-goal"]],
    })
    const implicitTargeting = makeEvent({
      id: "implicit-targeting",
      pubkey: wrapperPubkey,
      created_at: 30,
      ...buildTargetedPublicationV2({
        id: "implicit-target",
        kind: 9041,
        communities: [community],
      }),
    })
    const externalImplicitRoot = makeEvent({
      id: "external-implicit-root",
      pubkey: externalPubkey,
      created_at: 29,
      kind: 9041,
      tags: [["h", "implicit-target"]],
    })

    expect(
      getTargetedPublicationRootNotificationCandidates({
        targetingEvents: [explicitTargeting, implicitTargeting],
        rootEvents: [externalRoot, externalImplicitRoot],
        communityAddress: community.address,
        path,
        kind: 9041,
      }),
    ).toEqual([{path, latestEvent: explicitTargeting}])
  })

  it("uses community first-encounter baselines as checked timestamps", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt, hasNotificationForPath} =
      await import("./notifications")
    const viewerPubkey = "a".repeat(64)
    const otherViewerPubkey = "b".repeat(64)
    const community = makeTestCommunity(21, 22)
    const sibling = makeTestCommunity(21, 23)
    const authorPubkey = "e".repeat(64)
    const path = `/c/${community.naddr}/threads`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)
    const communityBaselines = {[baselineKey]: 100}

    expect(
      getNotificationCheckedAt({
        checked: {},
        path,
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(false)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 101}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: otherViewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
    expect(
      hasNotificationForPath({
        checked: {},
        path: `/c/${sibling.naddr}/threads`,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 99}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
  })

  it("applies community first-encounter baselines optimistically", async () => {
    const {
      effectiveCommunityNotificationBaselines,
      ensureCommunityNotificationBaseline,
      getCommunityNotificationBaselineKey,
    } = await import("./notifications")
    const viewerPubkey = "f".repeat(64)
    const community = makeTestCommunity(24, 25)
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    ensureCommunityNotificationBaseline({
      viewerPubkey,
      community,
      timestamp: 123,
    })

    expect(get(effectiveCommunityNotificationBaselines)[baselineKey]).toBe(123)
  })

  it("does not advance community baselines on later visits", async () => {
    const {
      communityNotificationBaselines,
      effectiveCommunityNotificationBaselines,
      ensureCommunityNotificationBaseline,
      getCommunityNotificationBaselineKey,
      hasNotificationForPath,
    } = await import("./notifications")
    const viewerPubkey = "2".repeat(64)
    const community = makeTestCommunity(26, 27)
    const authorPubkey = "4".repeat(64)
    const path = `/c/${community.naddr}/rooms/room-one`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    await communityNotificationBaselines.ready
    communityNotificationBaselines.set({version: 2, byCommunityAddress: {[baselineKey]: 100}})

    expect(
      ensureCommunityNotificationBaseline({
        viewerPubkey,
        community,
        timestamp: 200,
      }),
    ).toBe(false)
    expect(get(effectiveCommunityNotificationBaselines)[baselineKey]).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 150}),
        currentPubkey: viewerPubkey,
        communityBaselines: get(effectiveCommunityNotificationBaselines),
      }),
    ).toBe(true)
  })

  it("uses explicit path checks instead of later community baselines", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt, hasNotificationForPath} =
      await import("./notifications")
    const viewerPubkey = "5".repeat(64)
    const community = makeTestCommunity(28, 29)
    const authorPubkey = "7".repeat(64)
    const path = `/c/${community.naddr}/rooms/room-one`
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)
    const communityBaselines = {[baselineKey]: 200}

    expect(
      getNotificationCheckedAt({
        checked: {[path]: 100},
        path,
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(100)
    expect(
      hasNotificationForPath({
        checked: {[path]: 100},
        path,
        latestEvent: makeEvent({pubkey: authorPubkey, created_at: 150}),
        currentPubkey: viewerPubkey,
        communityBaselines,
      }),
    ).toBe(true)
  })

  it("does not apply community baselines to non-community paths", async () => {
    const {getCommunityNotificationBaselineKey, getNotificationCheckedAt} =
      await import("./notifications")
    const viewerPubkey = "a".repeat(64)
    const community = makeTestCommunity(30, 31)
    const baselineKey = getCommunityNotificationBaselineKey(viewerPubkey, community)

    expect(
      getNotificationCheckedAt({
        checked: {},
        path: "/chat/example",
        currentPubkey: viewerPubkey,
        communityBaselines: {[baselineKey]: 100},
      }),
    ).toBe(0)
  })
})
