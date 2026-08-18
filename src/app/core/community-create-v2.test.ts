import {describe, expect, it, vi} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {EventTemplate, SignedEvent, TrustedEvent} from "@welshman/util"
import {COMMUNITY_DEFINITION_KIND_V2} from "./community"
import {
  createCommunityV2,
  getCommunityCreationIntentKey,
  type CommunityCreationIntentStorage,
} from "./community-create-v2"

const controllerPubkey = "1".repeat(64)
const operationId = "operation-a"
const firstCommunityId = getPublicKey(new Uint8Array(32).fill(1))
const secondCommunityId = getPublicKey(new Uint8Array(32).fill(2))

const makeStorage = (): CommunityCreationIntentStorage & {values: Map<string, string>} => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
  }
}

const makeSignedEvent = (template: EventTemplate, index: number): SignedEvent =>
  ({
    ...template,
    id: index.toString(16).padStart(64, "0"),
    pubkey: controllerPubkey,
    created_at: index,
    sig: "2".repeat(128),
  }) as SignedEvent

const setup = ({storage = makeStorage(), ids = [firstCommunityId, secondCommunityId]} = {}) => {
  const secrets: Uint8Array[] = []
  let generated = 0
  let signed = 0
  const published: SignedEvent[] = []
  const dependencies = {
    operationId,
    storage,
    generateSecretKey: vi.fn(() => {
      const secret = new Uint8Array(32).fill(++generated)
      secrets.push(secret)
      return secret
    }),
    getPublicKey: () => ids[generated - 1],
    sign: vi.fn(async (template: EventTemplate) => makeSignedEvent(template, ++signed)),
    publishAndVerifyExact: vi.fn(async (event: SignedEvent) => {
      published.push(event)
      return event as TrustedEvent
    }),
  }
  const buildArtifacts = (communityId: string) => ({
    prerequisites: [{kind: 30000, content: "", tags: [["d", `members:${communityId}`]]}],
    definition: {
      kind: COMMUNITY_DEFINITION_KIND_V2,
      content: "",
      tags: [["d", communityId]],
    },
  })

  return {storage, secrets, published, dependencies, buildArtifacts}
}

describe("Communikeys V2 community creation", () => {
  it("keeps concurrent operations for one controller durable and distinct across retry", async () => {
    const context = setup()
    context.dependencies.publishAndVerifyExact.mockRejectedValue(new Error("offline"))

    const [first, second] = await Promise.allSettled([
      createCommunityV2({
        ...context.dependencies,
        operationId: "operation-a",
        controllerPubkey,
        buildArtifacts: context.buildArtifacts,
      }),
      createCommunityV2({
        ...context.dependencies,
        operationId: "operation-b",
        controllerPubkey,
        buildArtifacts: context.buildArtifacts,
      }),
    ])

    expect(first.status).toBe("rejected")
    expect(second.status).toBe("rejected")
    expect(
      context.storage.values.get(getCommunityCreationIntentKey(controllerPubkey, "operation-a")),
    ).toContain(firstCommunityId)
    expect(
      context.storage.values.get(getCommunityCreationIntentKey(controllerPubkey, "operation-b")),
    ).toContain(secondCommunityId)

    context.dependencies.publishAndVerifyExact.mockImplementation(
      async event => event as TrustedEvent,
    )
    const retried = await createCommunityV2({
      ...context.dependencies,
      operationId: "operation-a",
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
    })

    expect(retried.communityId).toBe(firstCommunityId)
    expect(context.dependencies.generateSecretKey).toHaveBeenCalledTimes(2)
    expect(
      context.storage.values.has(getCommunityCreationIntentKey(controllerPubkey, "operation-a")),
    ).toBe(false)
    expect(
      context.storage.values.has(getCommunityCreationIntentKey(controllerPubkey, "operation-b")),
    ).toBe(true)
  })

  it("allows two communities for one controller and uses a fresh ID after each success", async () => {
    const context = setup()

    const first = await createCommunityV2({
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
      ...context.dependencies,
    })
    const second = await createCommunityV2({
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
      ...context.dependencies,
    })

    expect(first.communityId).toBe(firstCommunityId)
    expect(second.communityId).toBe(secondCommunityId)
    expect(context.dependencies.generateSecretKey).toHaveBeenCalledTimes(2)
  })

  it("keeps a throwaway secret only long enough to derive the community ID", async () => {
    const context = setup()

    await createCommunityV2({
      controllerPubkey,
      buildArtifacts: communityId => {
        expect(context.secrets[0]).toEqual(new Uint8Array(32))
        return context.buildArtifacts(communityId)
      },
      ...context.dependencies,
    })

    expect(context.secrets[0]).toEqual(new Uint8Array(32))
    expect(
      context.storage.values.has(getCommunityCreationIntentKey(controllerPubkey, operationId)),
    ).toBe(false)
  })

  it("durably reuses the intended community ID across failure and resume", async () => {
    const context = setup()
    context.dependencies.publishAndVerifyExact.mockRejectedValueOnce(new Error("offline"))

    await expect(
      createCommunityV2({
        controllerPubkey,
        buildArtifacts: context.buildArtifacts,
        ...context.dependencies,
      }),
    ).rejects.toThrow("offline")

    expect(
      context.storage.values.get(getCommunityCreationIntentKey(controllerPubkey, operationId)),
    ).toContain(firstCommunityId)

    const resumed = await createCommunityV2({
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
      ...context.dependencies,
    })

    expect(resumed.communityId).toBe(firstCommunityId)
    expect(context.dependencies.generateSecretKey).toHaveBeenCalledTimes(1)
  })

  it("resumes the same public ID after reload without regenerating secret material", async () => {
    const storage = makeStorage()
    const first = setup({storage})
    first.dependencies.publishAndVerifyExact.mockRejectedValueOnce(new Error("offline"))

    await expect(
      createCommunityV2({
        controllerPubkey,
        buildArtifacts: first.buildArtifacts,
        ...first.dependencies,
      }),
    ).rejects.toThrow("offline")

    const reloaded = setup({storage})
    const result = await createCommunityV2({
      controllerPubkey,
      buildArtifacts: reloaded.buildArtifacts,
      ...reloaded.dependencies,
    })

    expect(result.communityId).toBe(firstCommunityId)
    expect(reloaded.dependencies.generateSecretKey).not.toHaveBeenCalled()
    expect(storage.values.has(getCommunityCreationIntentKey(controllerPubkey, operationId))).toBe(
      false,
    )
  })

  it("publishes no kind-0 event and verifies prerequisites before kind 32222 activation", async () => {
    const context = setup()

    await createCommunityV2({
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
      ...context.dependencies,
    })

    expect(context.published.map(event => event.kind)).toEqual([
      30000,
      COMMUNITY_DEFINITION_KIND_V2,
    ])
    expect(context.published.some(event => event.kind === 0)).toBe(false)
  })

  it("does not sign activation before prerequisite exact readback", async () => {
    const context = setup()
    let releasePrerequisite!: () => void
    const prerequisiteReadback = new Promise<void>(resolve => {
      releasePrerequisite = resolve
    })
    context.dependencies.publishAndVerifyExact.mockImplementationOnce(async event => {
      await prerequisiteReadback
      return event as TrustedEvent
    })

    const pending = createCommunityV2({
      controllerPubkey,
      buildArtifacts: context.buildArtifacts,
      ...context.dependencies,
    })
    await Promise.resolve()

    expect(context.dependencies.sign).toHaveBeenCalledTimes(1)
    releasePrerequisite()
    await pending
    expect(context.dependencies.sign).toHaveBeenCalledTimes(2)
  })

  it("rejects signed artifacts from a different controller", async () => {
    const context = setup()
    context.dependencies.sign.mockImplementationOnce(async template => ({
      ...makeSignedEvent(template, 1),
      pubkey: "3".repeat(64),
    }))

    await expect(
      createCommunityV2({
        controllerPubkey,
        buildArtifacts: context.buildArtifacts,
        ...context.dependencies,
      }),
    ).rejects.toThrow("controller")
  })

  it("rejects duplicate or mismatched definition identifiers", async () => {
    const context = setup()

    await expect(
      createCommunityV2({
        controllerPubkey,
        buildArtifacts: communityId => ({
          prerequisites: [],
          definition: {
            ...context.buildArtifacts(communityId).definition,
            tags: [
              ["d", communityId],
              ["d", secondCommunityId],
            ],
          },
        }),
        ...context.dependencies,
      }),
    ).rejects.toThrow("community ID")
  })

  it("rejects non-exact readback and retains the intent for retry", async () => {
    const context = setup()
    context.dependencies.publishAndVerifyExact.mockImplementationOnce(async event => ({
      ...event,
      id: "f".repeat(64),
    }))

    await expect(
      createCommunityV2({
        controllerPubkey,
        buildArtifacts: context.buildArtifacts,
        ...context.dependencies,
      }),
    ).rejects.toThrow("exact event")

    expect(
      context.storage.values.get(getCommunityCreationIntentKey(controllerPubkey, operationId)),
    ).toContain(firstCommunityId)
  })
})
