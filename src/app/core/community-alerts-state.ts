import {derived, get, writable, type Readable} from "svelte/store"
import {parseJson} from "@welshman/lib"
import {AuthStatus, Pool, publish, request} from "@welshman/net"
import {Router} from "@welshman/router"
import {deriveItemsByKey, getter, makeLoadItem} from "@welshman/store"
import {DELETE, makeEvent, type SignedEvent, type TrustedEvent} from "@welshman/util"
import {makeOutboxLoader, makeUserData, pubkey, repository, signer} from "@welshman/app"
import {getUserDataPublishRelays} from "@app/core/community-relays"
import {publishRequiredCommunityEvent} from "@app/core/community-publish"
import {
  activeExactCommunityPointer,
  activeUserCommunityRefs,
  hydrateCommunityPreferences,
} from "@app/core/community-state"
import {APP_BASE_URL} from "@app/core/state"
import {
  waitForProviderRelayAuth,
  withOperationScopedProviderAuthSocket,
} from "@app/core/provider-relay-auth"
import {
  COMMUNITY_ALERTS_SETTINGS_DTAG,
  COMMUNITY_ALERTS_SETTINGS_KIND,
  COMMUNITY_ALERTS_STATUS_KIND,
  COMMUNITY_ALERTS_SUBSCRIPTION_KIND,
  assertCommunityAlertProviderQueryComplete,
  buildCommunityAlertPayload,
  createCommunityAlertOperationQueue,
  decryptCommunityAlertSettingsEventWithSource,
  defaultCommunityAlertSettings,
  discoverCommunityAlertProviders,
  getCommunityAlertDeletionTags,
  getLegacyCommunityAlertStatusDtag,
  getLegacyCommunityAlertSubscriptionDtag,
  getCommunityAlertStatusDtag,
  getCommunityAlertSubscriptionDtag,
  getCommunityAlertSubscriptionTags,
  getNextCommunityAlertCreatedAt,
  isCommunityAlertProviderAdvertised,
  normalizeCommunityAlertDeliveryProfile,
  normalizeCommunityAlertPreferences,
  normalizeCommunityAlertSettings,
  parseCommunityAlertPayload,
  parseCommunityAlertStatus,
  resolveCommunityAlertSettingsItem,
  runCommunityAlertSaveSequence,
  selectCommunityAlertStatusEvent,
  selectCommunityAlertSubscriptionEvent,
  type CommunityAlertDeliveryProfile,
  type CommunityAlertPayload,
  type CommunityAlertPreferences,
  type CommunityAlertProviderGroup,
  type CommunityAlertRegistration,
  type CommunityAlertSettings,
  type CommunityAlertSettingsItem,
  type CommunityAlertStatus,
} from "@app/core/community-alerts"
import {
  getCommunityAlertServiceDescriptorKey,
  normalizeCommunityAlertService,
  normalizePubkey,
  parseCommunityDefinitionAddress,
  type CommunityAlertService,
} from "@app/core/community"
import {
  isEmailDigestTimezone,
  normalizeEmailDigestEmail,
  normalizeEmailDigestIntervalDays,
  normalizeEmailDigestLocalTime,
} from "@app/core/email-digest"

type ActiveSigner = NonNullable<ReturnType<typeof signer.get>>

type CommunityAlertSession = {
  userPubkey: string
  currentSigner: ActiveSigner
}

export type {CommunityAlertSettingsItem} from "@app/core/community-alerts"

export type CommunityAlertSettingsHydration = {
  pubkey: string
  signer?: ActiveSigner
  status: "idle" | "loading" | "ready" | "error"
  item?: CommunityAlertSettingsItem
  error?: string
}

export type CommunityAlertProviderState = {
  subscription?: TrustedEvent
  subscriptionPayload?: CommunityAlertPayload
  statusEvent?: TrustedEvent
  status?: CommunityAlertStatus
  statusError?: string
}

export type CommunityAlertDeliverySyncError = {
  communityAddress: string
  providerKey: string
  message: string
}

export type CommunityAlertDeliverySyncResult = {
  settings: CommunityAlertSettings
  errors: CommunityAlertDeliverySyncError[]
}

const captureSession = (expectedPubkey?: string): CommunityAlertSession => {
  const userPubkey = pubkey.get()
  const currentSigner = signer.get()
  if (!userPubkey || !currentSigner) throw new Error("Sign in to manage community alerts.")
  if (expectedPubkey && userPubkey !== normalizePubkey(expectedPubkey)) {
    throw new Error("Community alert settings belong to a different active signer.")
  }

  return {userPubkey, currentSigner}
}

const isSessionActive = ({userPubkey, currentSigner}: CommunityAlertSession) =>
  pubkey.get() === userPubkey && signer.get() === currentSigner

const assertSessionActive = (session: CommunityAlertSession) => {
  if (!isSessionActive(session)) {
    throw new Error("The active signer changed during the community alert operation.")
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const communityAlertProviderGroups: Readable<CommunityAlertProviderGroup[]> = derived(
  [activeUserCommunityRefs, activeExactCommunityPointer],
  ([$communityRefs, $activeCommunity]) =>
    discoverCommunityAlertProviders({
      communityRefs: $communityRefs,
      activeCommunityAddress: $activeCommunity?.address,
    }),
  [] as CommunityAlertProviderGroup[],
)

const isCommunityAlertSettingsEvent = (event: TrustedEvent, userPubkey: string) =>
  event.kind === COMMUNITY_ALERTS_SETTINGS_KIND &&
  event.pubkey === userPubkey &&
  event.tags.length === 1 &&
  event.tags[0]?.length === 2 &&
  event.tags[0][0] === "d" &&
  event.tags[0][1] === COMMUNITY_ALERTS_SETTINGS_DTAG

const getCommunityAlertSettingsRelays = () =>
  getUserDataPublishRelays(Router.get().FromUser().getUrls(), [])

export const communityAlertSettingsByPubkey = deriveItemsByKey<CommunityAlertSettingsItem>({
  repository,
  getKey: item => item.event.pubkey,
  filters: [{kinds: [COMMUNITY_ALERTS_SETTINGS_KIND], "#d": [COMMUNITY_ALERTS_SETTINGS_DTAG]}],
  eventToItem: async event => {
    const activePubkey = pubkey.get()
    if (!activePubkey || !isCommunityAlertSettingsEvent(event, activePubkey)) return undefined
    const session = captureSession(event.pubkey)
    assertSessionActive(session)
    return resolveCommunityAlertSettingsItem({
      event,
      decrypt: async () => {
        assertSessionActive(session)
        const decrypted = await decryptCommunityAlertSettingsEventWithSource({
          event,
          activePubkey: session.userPubkey,
          decrypt: (recipient, content) => session.currentSigner.nip44.decrypt(recipient, content),
          definitions: get(activeUserCommunityRefs).map(ref => ref.definition),
        })
        assertSessionActive(session)
        return decrypted
      },
    })
  },
})

export const getCommunityAlertSettingsByPubkey = getter(communityAlertSettingsByPubkey)
export const getCommunityAlertSettings = (userPubkey: string) =>
  getCommunityAlertSettingsByPubkey().get(userPubkey)
const fetchCommunityAlertSettings = makeOutboxLoader(COMMUNITY_ALERTS_SETTINGS_KIND, {
  "#d": [COMMUNITY_ALERTS_SETTINGS_DTAG],
})
export const loadCommunityAlertSettings = makeLoadItem(
  fetchCommunityAlertSettings,
  getCommunityAlertSettings,
)

export const communityAlertSettingsHydration = writable<CommunityAlertSettingsHydration>({
  pubkey: "",
  status: "idle",
})

const repositoryUserCommunityAlertSettings = makeUserData(communityAlertSettingsByPubkey)
export const userCommunityAlertSettings = derived(
  [repositoryUserCommunityAlertSettings, communityAlertSettingsHydration, pubkey, signer],
  ([$repositorySettings, $hydration, $pubkey, $signer]) => {
    if ($hydration.pubkey === $pubkey && $hydration.signer !== $signer) return undefined

    return (
      ($hydration.pubkey === $pubkey && $hydration.signer === $signer
        ? $hydration.item
        : undefined) || $repositorySettings
    )
  },
)
export const userCommunityAlertSettingsValues = derived(
  userCommunityAlertSettings,
  $settings => $settings?.values || defaultCommunityAlertSettings,
)
export const userCommunityAlertDeliveryProfile = derived(
  userCommunityAlertSettingsValues,
  $settings => $settings.deliveryProfile,
)
export const userCommunityAlertRegistrations = derived(
  userCommunityAlertSettingsValues,
  $settings => $settings.communities,
)

let pendingSettingsHydration:
  | {session: CommunityAlertSession; promise: Promise<CommunityAlertSettingsItem | undefined>}
  | undefined

const decryptLatestCommunityAlertSettings = async (
  session: CommunityAlertSession,
): Promise<CommunityAlertSettingsItem | undefined> => {
  const event = repository
    .query([
      {
        kinds: [COMMUNITY_ALERTS_SETTINGS_KIND],
        authors: [session.userPubkey],
        "#d": [COMMUNITY_ALERTS_SETTINGS_DTAG],
      },
    ])
    .filter(candidate => isCommunityAlertSettingsEvent(candidate, session.userPubkey))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
  if (!event) return undefined

  return resolveCommunityAlertSettingsItem({
    event,
    hydrated: getCommunityAlertSettings(session.userPubkey),
    decrypt: async () => {
      assertSessionActive(session)
      const decrypted = await decryptCommunityAlertSettingsEventWithSource({
        event,
        activePubkey: session.userPubkey,
        decrypt: (recipient, content) => session.currentSigner.nip44.decrypt(recipient, content),
        definitions: get(activeUserCommunityRefs).map(ref => ref.definition),
      })
      assertSessionActive(session)
      return decrypted
    },
  })
}

const fetchLatestCommunityAlertSettings = async (session: CommunityAlertSession) => {
  const relays = getCommunityAlertSettingsRelays()
  if (relays.length === 0) throw new Error("No account data relay is available.")
  const filters = [
    {
      kinds: [COMMUNITY_ALERTS_SETTINGS_KIND],
      authors: [session.userPubkey],
      "#d": [COMMUNITY_ALERTS_SETTINGS_DTAG],
      limit: 10,
    },
  ]
  const eventGroups = await Promise.all(
    relays.map(async relay => {
      let eose = false
      let failure = ""
      let timedOut = false
      const controller = new AbortController()
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, 10_000)

      try {
        const events = await request({
          relays: [relay],
          filters,
          autoClose: true,
          signal: controller.signal,
          onEose: () => {
            eose = true
          },
          onClosed: reason => {
            failure = reason || "closed without a reason"
          },
          onDisconnect: () => {
            failure = "disconnected"
          },
        })
        if (timedOut) throw new Error(`Account data relay ${relay} timed out before EOSE.`)
        if (failure) throw new Error(`Account data relay ${relay} ${failure}.`)
        if (!eose) throw new Error(`Account data relay ${relay} ended before EOSE.`)

        return events
      } finally {
        clearTimeout(timeout)
      }
    }),
  )
  assertSessionActive(session)
  const event = eventGroups
    .flat()
    .filter(candidate => isCommunityAlertSettingsEvent(candidate, session.userPubkey))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
  if (!event) {
    if (
      repository
        .query([
          {
            kinds: [COMMUNITY_ALERTS_SETTINGS_KIND],
            authors: [session.userPubkey],
            "#d": [COMMUNITY_ALERTS_SETTINGS_DTAG],
          },
        ])
        .some(candidate => isCommunityAlertSettingsEvent(candidate, session.userPubkey))
    ) {
      throw new Error("Current community alert settings are unavailable on account data relays.")
    }

    return undefined
  }

  repository.publish(event)
  return decryptLatestCommunityAlertSettings(session)
}

export const hydrateCommunityAlertSettings = async (
  userPubkey = pubkey.get(),
  {force = false}: {force?: boolean} = {},
) => {
  const session = captureSession(userPubkey)
  const current = get(communityAlertSettingsHydration)
  const previousReady =
    current.pubkey === session.userPubkey &&
    current.signer === session.currentSigner &&
    current.status === "ready"
      ? current
      : undefined
  if (
    !force &&
    current.pubkey === session.userPubkey &&
    current.signer === session.currentSigner &&
    current.status === "ready"
  ) {
    return current.item || getCommunityAlertSettings(session.userPubkey)
  }
  if (
    pendingSettingsHydration?.session.userPubkey === session.userPubkey &&
    pendingSettingsHydration.session.currentSigner === session.currentSigner
  ) {
    return pendingSettingsHydration.promise
  }

  communityAlertSettingsHydration.set({
    pubkey: session.userPubkey,
    signer: session.currentSigner,
    status: "loading",
  })
  const promise: Promise<CommunityAlertSettingsItem | undefined> = (async () => {
    await hydrateCommunityPreferences()
    assertSessionActive(session)
    let item: CommunityAlertSettingsItem | undefined
    if (force) {
      item = await fetchLatestCommunityAlertSettings(session)
    } else {
      await loadCommunityAlertSettings(session.userPubkey)
      assertSessionActive(session)
      item = await decryptLatestCommunityAlertSettings(session)
    }
    if (item?.sourceVersion === 1) {
      await publishSettingsForSession(session, item.values, item.event.created_at)
      assertSessionActive(session)
      item = {...get(communityAlertSettingsHydration).item!, sourceVersion: 2}
    }

    if (isSessionActive(session)) {
      communityAlertSettingsHydration.set({
        pubkey: session.userPubkey,
        signer: session.currentSigner,
        status: "ready",
        ...(item ? {item} : {}),
      })
    }

    return item
  })()
    .catch(error => {
      if (isSessionActive(session)) {
        communityAlertSettingsHydration.set(
          force && previousReady
            ? previousReady
            : {
                pubkey: session.userPubkey,
                signer: session.currentSigner,
                status: "error",
                error: errorMessage(error),
              },
        )
      }
      throw error
    })
    .finally(() => {
      if (pendingSettingsHydration?.promise === promise) pendingSettingsHydration = undefined
    })

  pendingSettingsHydration = {session, promise}
  return promise
}

const requireSettingsHydrated = (session: CommunityAlertSession) => {
  const hydration = get(communityAlertSettingsHydration)
  if (
    hydration.pubkey !== session.userPubkey ||
    hydration.signer !== session.currentSigner ||
    hydration.status !== "ready"
  ) {
    throw new Error("Wait for encrypted community alert settings to finish loading.")
  }
}

const publishSettingsForSession = async (
  session: CommunityAlertSession,
  settings: CommunityAlertSettings,
  currentCreatedAt = get(userCommunityAlertSettings)?.event.created_at,
) => {
  assertSessionActive(session)
  const normalized = normalizeCommunityAlertSettings(settings)
  const content = await session.currentSigner.nip44.encrypt(
    session.userPubkey,
    JSON.stringify(normalized),
  )
  assertSessionActive(session)
  const event = await session.currentSigner.sign(
    makeEvent(COMMUNITY_ALERTS_SETTINGS_KIND, {
      content,
      tags: [["d", COMMUNITY_ALERTS_SETTINGS_DTAG]],
      created_at: getNextCommunityAlertCreatedAt(currentCreatedAt),
    }),
  )
  assertSessionActive(session)
  const relays = getCommunityAlertSettingsRelays()
  if (relays.length === 0) throw new Error("No account data relay is available.")
  assertSessionActive(session)
  const {acceptedRelays} = await publishRequiredCommunityEvent({event, relays})
  assertSessionActive(session)
  if (acceptedRelays.length === 0) {
    throw new Error("No account data relay accepted community alert settings.")
  }

  repository.publish(event)
  communityAlertSettingsHydration.update(hydration =>
    hydration.pubkey === session.userPubkey && hydration.signer === session.currentSigner
      ? {
          pubkey: session.userPubkey,
          signer: session.currentSigner,
          status: "ready",
          item: {event, values: normalized, sourceVersion: 2},
        }
      : hydration,
  )

  return normalized
}

let settingsWriteQueue = Promise.resolve<unknown>(undefined)
const runCommunityAlertOperation = createCommunityAlertOperationQueue()

const withCommunityAlertLifecycle = <T>(
  session: CommunityAlertSession,
  communityAddress: string,
  run: () => Promise<T>,
) =>
  runCommunityAlertOperation(`${session.userPubkey}:${communityAddress}`, async () => {
    assertSessionActive(session)
    requireSettingsHydrated(session)
    await hydrateCommunityAlertSettings(session.userPubkey, {force: true})
    assertSessionActive(session)
    requireSettingsHydrated(session)

    return run()
  })

const updateSettingsForSession = (
  session: CommunityAlertSession,
  update: (settings: CommunityAlertSettings) => CommunityAlertSettings,
) => {
  const operation = settingsWriteQueue
    .catch(() => undefined)
    .then(() => {
      assertSessionActive(session)

      return publishSettingsForSession(session, update(get(userCommunityAlertSettingsValues)))
    })
  settingsWriteQueue = operation

  return operation
}

export const publishCommunityAlertSettings = async (settings: CommunityAlertSettings) => {
  const session = captureSession()
  requireSettingsHydrated(session)
  await hydrateCommunityAlertSettings(session.userPubkey, {force: true})
  assertSessionActive(session)
  requireSettingsHydrated(session)

  return updateSettingsForSession(session, () => settings)
}

const withAuthenticatedProvider = <T>(
  session: CommunityAlertSession,
  provider: CommunityAlertService,
  run: (pool: Pool) => Promise<T>,
) => {
  const pool = new Pool()
  const socket = pool.get(provider.requestRelay)

  return withOperationScopedProviderAuthSocket(socket, async () => {
    let signingActive = true
    let authTimeout: ReturnType<typeof setTimeout> | undefined

    try {
      assertSessionActive(session)
      const signAuthEvent = async (event: Parameters<typeof session.currentSigner.sign>[0]) => {
        assertSessionActive(session)
        const signed = await session.currentSigner.sign(event)
        assertSessionActive(session)
        if (!signingActive) throw new Error("Community alert provider authentication timed out.")

        return signed
      }
      const authAttempt = socket.auth.retryAuth(signAuthEvent)
      await Promise.race([
        authAttempt,
        new Promise<never>((_, reject) => {
          authTimeout = setTimeout(() => {
            signingActive = false
            reject(new Error("Community alert provider authentication timed out."))
          }, 10_000)
        }),
      ])
      clearTimeout(authTimeout)
      authTimeout = undefined
      assertSessionActive(session)
      const status = await waitForProviderRelayAuth(socket.auth, 10_000, signAuthEvent)
      assertSessionActive(session)
      if (status !== AuthStatus.Ok) {
        throw new Error("Community alert provider authentication did not complete.")
      }

      return await run(pool)
    } finally {
      signingActive = false
      clearTimeout(authTimeout)
      pool.clear()
    }
  })
}

const publishAcceptedEvent = async (
  session: CommunityAlertSession,
  event: SignedEvent,
  provider: CommunityAlertService,
  label: string,
) =>
  withAuthenticatedProvider(session, provider, async pool => {
    assertSessionActive(session)
    await publishRequiredCommunityEvent({
      event,
      relays: [provider.requestRelay],
      requiredRelay: provider.requestRelay,
      timeout: 12_000,
      publishEvent: options => publish({...options, context: {pool}}),
    }).catch(error => {
      throw new Error(`${label} was not accepted by the provider relay: ${errorMessage(error)}`)
    })
    assertSessionActive(session)
  })

const getCommunityAlertManageUrl = () => {
  const browserOrigin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : ""
  const base = APP_BASE_URL || browserOrigin
  if (!base) throw new Error("Budabit needs a public HTTPS app URL for alert management.")

  return new URL("/settings/notifications", base).toString()
}

const getCommunityAlertLocale = () =>
  typeof navigator !== "undefined" ? navigator.language?.trim() || undefined : undefined

const queryProviderStateForSession = async ({
  session,
  communityAddress,
  provider,
}: {
  session: CommunityAlertSession
  communityAddress: string
  provider: CommunityAlertService
}): Promise<CommunityAlertProviderState> => {
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  const normalizedProvider = normalizeCommunityAlertService(provider)
  if (!community || !normalizedProvider) throw new Error("Invalid community alert provider query.")
  const legacyCommunityId = get(userCommunityAlertSettingsValues).communities[community]
    ?.legacyCommunityId
  const subscriptionDtags = [
    getCommunityAlertSubscriptionDtag(community),
    ...(legacyCommunityId ? [getLegacyCommunityAlertSubscriptionDtag(legacyCommunityId)] : []),
  ]
  const statusDtags = [
    getCommunityAlertStatusDtag(community, session.userPubkey),
    ...(legacyCommunityId
      ? [getLegacyCommunityAlertStatusDtag(legacyCommunityId, session.userPubkey)]
      : []),
  ]

  return withAuthenticatedProvider(session, normalizedProvider, async pool => {
    const completion = {
      authenticated: true,
      eose: false,
      timedOut: false,
      disconnected: false,
      closedReason: undefined as string | undefined,
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      completion.timedOut = true
      controller.abort()
    }, 10_000)
    let events: TrustedEvent[]
    try {
      events = (await request({
        relays: [normalizedProvider.requestRelay],
        filters: [
          {
            kinds: [COMMUNITY_ALERTS_SUBSCRIPTION_KIND],
            authors: [session.userPubkey],
            "#d": subscriptionDtags,
            "#p": [normalizedProvider.servicePubkey],
            limit: 10,
          },
          {
            kinds: [COMMUNITY_ALERTS_STATUS_KIND],
            authors: [normalizedProvider.servicePubkey],
            "#d": statusDtags,
            "#p": [session.userPubkey],
            limit: 10,
          },
        ],
        autoClose: true,
        context: {pool},
        signal: controller.signal,
        onEose: () => {
          completion.eose = true
        },
        onClosed: reason => {
          completion.closedReason = reason || "closed without a reason"
        },
        onDisconnect: () => {
          completion.disconnected = true
        },
      })) as TrustedEvent[]
    } catch (error) {
      if (completion.timedOut || completion.closedReason || completion.disconnected) {
        assertCommunityAlertProviderQueryComplete(completion)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
    assertSessionActive(session)
    assertCommunityAlertProviderQueryComplete(completion)

    const subscription = selectCommunityAlertSubscriptionEvent(
      events,
      community,
      session.userPubkey,
      normalizedProvider,
      legacyCommunityId,
    )
    const statusEvent = selectCommunityAlertStatusEvent(
      events,
      community,
      session.userPubkey,
      normalizedProvider,
      legacyCommunityId,
    )
    let subscriptionPayload: CommunityAlertPayload | undefined
    let status: CommunityAlertStatus | undefined
    let statusError = ""

    if (subscription) {
      try {
        assertSessionActive(session)
        const plaintext = await session.currentSigner.nip44.decrypt(
          normalizedProvider.servicePubkey,
          subscription.content,
        )
        assertSessionActive(session)
        const parsedPayload = parseJson(plaintext)
        subscriptionPayload = parseCommunityAlertPayload(parsedPayload)
        if (
          !subscriptionPayload &&
          legacyCommunityId &&
          parsedPayload?.community === legacyCommunityId
        ) {
          subscriptionPayload = parseCommunityAlertPayload({...parsedPayload, community})
        }
        if (!subscriptionPayload || subscriptionPayload.community !== community) {
          subscriptionPayload = undefined
          statusError = "The saved provider registration is invalid."
        }
      } catch (error) {
        assertSessionActive(session)
        statusError = "The saved provider registration could not be decrypted."
      }
    }
    if (statusEvent) {
      try {
        assertSessionActive(session)
        const plaintext = await session.currentSigner.nip44.decrypt(
          normalizedProvider.servicePubkey,
          statusEvent.content,
        )
        assertSessionActive(session)
        status = parseCommunityAlertStatus(parseJson(plaintext))
        if (!status) statusError = "The provider returned an invalid status response."
      } catch (error) {
        assertSessionActive(session)
        statusError = "The provider status could not be decrypted."
      }
    }

    return {
      ...(subscription ? {subscription} : {}),
      ...(subscriptionPayload ? {subscriptionPayload} : {}),
      ...(statusEvent ? {statusEvent} : {}),
      ...(status ? {status} : {}),
      ...(statusError ? {statusError} : {}),
    }
  })
}

export const queryCommunityAlertProviderState = async ({
  communityAddress,
  provider,
}: {
  communityAddress: string
  provider: CommunityAlertService
}) => {
  const session = captureSession()

  return queryProviderStateForSession({session, communityAddress, provider})
}

const buildCurrentPayload = ({
  communityAddress,
  deliveryProfile,
  preferences,
}: {
  communityAddress: string
  deliveryProfile: CommunityAlertDeliveryProfile
  preferences: CommunityAlertPreferences
}) =>
  buildCommunityAlertPayload({
    community: communityAddress,
    email: deliveryProfile.email,
    locale: getCommunityAlertLocale(),
    manageUrl: getCommunityAlertManageUrl(),
    intervalDays: deliveryProfile.intervalDays,
    localTime: deliveryProfile.localTime,
    timezone: deliveryProfile.timezone,
    preferences,
  })

const publishSubscriptionForSession = async ({
  session,
  communityAddress,
  provider,
  deliveryProfile,
  preferences,
  minimumCreatedAt = 0,
}: {
  session: CommunityAlertSession
  communityAddress: string
  provider: CommunityAlertService
  deliveryProfile: CommunityAlertDeliveryProfile
  preferences: CommunityAlertPreferences
  minimumCreatedAt?: number
}) => {
  const payload = buildCurrentPayload({communityAddress, deliveryProfile, preferences})
  const providerState = await queryProviderStateForSession({session, communityAddress, provider})
  assertSessionActive(session)
  const content = await session.currentSigner.nip44.encrypt(
    provider.servicePubkey,
    JSON.stringify(payload),
  )
  assertSessionActive(session)
  const event = await session.currentSigner.sign(
    makeEvent(COMMUNITY_ALERTS_SUBSCRIPTION_KIND, {
      content,
      tags: getCommunityAlertSubscriptionTags(communityAddress, provider.servicePubkey),
      created_at: getNextCommunityAlertCreatedAt(
        Math.max(providerState.subscription?.created_at || 0, minimumCreatedAt),
      ),
    }),
  )
  assertSessionActive(session)
  await publishAcceptedEvent(session, event, provider, "Community alert registration")

  return queryProviderStateForSession({session, communityAddress, provider})
}

const deleteRegistrationForSession = async ({
  session,
  communityAddress,
  provider,
  persistDeletionCreatedAt,
}: {
  session: CommunityAlertSession
  communityAddress: string
  provider: CommunityAlertService
  persistDeletionCreatedAt?: (createdAt: number) => Promise<unknown>
}) => {
  const providerState = await queryProviderStateForSession({session, communityAddress, provider})
  if (!providerState.subscription) return undefined
  const legacyCommunityId = get(userCommunityAlertSettingsValues).communities[communityAddress]
    ?.legacyCommunityId
  const subscriptionUsesLegacyCoordinate =
    legacyCommunityId &&
    providerState.subscription.tags[0]?.[1] ===
      getLegacyCommunityAlertSubscriptionDtag(legacyCommunityId)
  assertSessionActive(session)
  const event = await session.currentSigner.sign(
    makeEvent(DELETE, {
      created_at: getNextCommunityAlertCreatedAt(providerState.subscription.created_at),
      tags: getCommunityAlertDeletionTags({
        communityAddress,
        ...(subscriptionUsesLegacyCoordinate ? {legacyCommunityId} : {}),
        userPubkey: session.userPubkey,
        servicePubkey: provider.servicePubkey,
      }),
    }),
  )
  assertSessionActive(session)
  await persistDeletionCreatedAt?.(event.created_at)
  assertSessionActive(session)
  await publishAcceptedEvent(session, event, provider, "Community alert deletion")

  return event
}

const withCommunityRegistration = (
  settings: CommunityAlertSettings,
  communityAddress: string,
  registration: CommunityAlertRegistration,
) => ({
  ...settings,
  communities: {...settings.communities, [communityAddress]: registration},
})

const withLastDeletionCreatedAt = (
  registration: CommunityAlertRegistration,
  ...createdAts: Array<number | undefined>
) => {
  const lastDeletionCreatedAt = Math.max(
    registration.lastDeletionCreatedAt || 0,
    ...createdAts.map(value => value || 0),
  )

  return lastDeletionCreatedAt ? {...registration, lastDeletionCreatedAt} : registration
}

const uniqueProviders = (providers: Array<CommunityAlertService | undefined>) => {
  const result: CommunityAlertService[] = []
  const seen = new Set<string>()
  for (const candidate of providers) {
    const provider = candidate ? normalizeCommunityAlertService(candidate) : undefined
    const key = provider ? getCommunityAlertServiceDescriptorKey(provider) : ""
    if (!provider || !key || seen.has(key)) continue
    seen.add(key)
    result.push(provider)
  }

  return result
}

const persistRegistration = (
  session: CommunityAlertSession,
  communityAddress: string,
  registration: CommunityAlertRegistration,
) =>
  updateSettingsForSession(session, settings =>
    withCommunityRegistration(settings, communityAddress, registration),
  )

export const saveAndEnableCommunityAlerts = async ({
  communityAddress,
  provider,
  preferences,
}: {
  communityAddress: string
  provider: CommunityAlertService
  preferences: CommunityAlertPreferences
}) => {
  const session = captureSession()
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  const normalizedProvider = normalizeCommunityAlertService(provider)
  if (!community || !normalizedProvider) throw new Error("Choose a valid community alert provider.")

  return withCommunityAlertLifecycle(session, community, async () => {
    if (
      !isCommunityAlertProviderAdvertised({
        communityAddress: community,
        provider: normalizedProvider,
        providerGroups: get(communityAlertProviderGroups),
      })
    ) {
      throw new Error("Choose a provider advertised by a community where you have an active role.")
    }

    const settings = get(userCommunityAlertSettingsValues)
    const current = settings.communities[community]
    const nextProviderKey = getCommunityAlertServiceDescriptorKey(normalizedProvider)
    const normalizedPreferences = normalizeCommunityAlertPreferences(preferences)
    buildCurrentPayload({
      communityAddress: community,
      deliveryProfile: settings.deliveryProfile,
      preferences: normalizedPreferences,
    })

    const providersToDelete = uniqueProviders([
      ...(current?.pendingCleanup || []),
      ...(current?.enabled && current.provider ? [current.provider] : []),
      ...(current?.pendingProvider &&
      getCommunityAlertServiceDescriptorKey(current.pendingProvider) !== nextProviderKey
        ? [current.pendingProvider]
        : []),
    ]).filter(candidate => getCommunityAlertServiceDescriptorKey(candidate) !== nextProviderKey)
    const switchingProvider = providersToDelete.length > 0
    const currentProviderWillBeDeleted = Boolean(
      current?.provider &&
      providersToDelete.some(
        candidate =>
          getCommunityAlertServiceDescriptorKey(candidate) ===
          getCommunityAlertServiceDescriptorKey(current.provider!),
      ),
    )
    const pending = withLastDeletionCreatedAt(
      {
        enabled: Boolean(current?.enabled && current.provider),
        ...(current?.legacyCommunityId ? {legacyCommunityId: current.legacyCommunityId} : {}),
        ...(current?.provider ? {provider: current.provider} : {}),
        pendingProvider: normalizedProvider,
        ...(providersToDelete.length > 0 ? {pendingCleanup: providersToDelete} : {}),
        preferences: normalizedPreferences,
      },
      current?.lastDeletionCreatedAt,
    )
    const oldProviderDeleted = withLastDeletionCreatedAt(
      {
        enabled: currentProviderWillBeDeleted ? false : pending.enabled,
        ...(current?.provider ? {provider: current.provider} : {}),
        pendingProvider: normalizedProvider,
        preferences: normalizedPreferences,
      },
      current?.lastDeletionCreatedAt,
    )
    const registered = withLastDeletionCreatedAt(
      {
        enabled: true,
        provider: normalizedProvider,
        preferences: normalizedPreferences,
      },
      current?.lastDeletionCreatedAt,
    )

    let latestDeletionCreatedAt = 0
    return runCommunityAlertSaveSequence({
      switchingProvider,
      persistPending: () => persistRegistration(session, community, pending),
      deleteOldProvider: async () => {
        for (const oldProvider of providersToDelete) {
          const deletion = await deleteRegistrationForSession({
            session,
            communityAddress: community,
            provider: oldProvider,
            persistDeletionCreatedAt: async createdAt => {
              latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, createdAt)
              await persistRegistration(
                session,
                community,
                withLastDeletionCreatedAt(pending, latestDeletionCreatedAt),
              )
            },
          })
          latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, deletion?.created_at || 0)
        }
      },
      persistOldProviderDeleted: () =>
        persistRegistration(
          session,
          community,
          withLastDeletionCreatedAt(oldProviderDeleted, latestDeletionCreatedAt),
        ),
      publishNewRegistration: () =>
        publishSubscriptionForSession({
          session,
          communityAddress: community,
          provider: normalizedProvider,
          deliveryProfile: settings.deliveryProfile,
          preferences: normalizedPreferences,
          minimumCreatedAt: Math.max(current?.lastDeletionCreatedAt || 0, latestDeletionCreatedAt),
        }),
      persistRegistered: () =>
        persistRegistration(
          session,
          community,
          withLastDeletionCreatedAt(registered, latestDeletionCreatedAt),
        ),
      persistFailure: async (phase, error) => {
        const base = phase === "cleanup" ? pending : oldProviderDeleted
        try {
          await persistRegistration(session, community, {
            ...withLastDeletionCreatedAt(base, latestDeletionCreatedAt),
            lastError: errorMessage(error),
          })
        } catch {
          // The pre-operation snapshot still retains every endpoint needed for a retry.
        }
      },
    })
  })
}

const validateDeliveryProfile = (profile: CommunityAlertDeliveryProfile) => {
  const normalized = normalizeCommunityAlertDeliveryProfile(profile)
  if (!normalizeEmailDigestEmail(profile.email)) {
    throw new Error("Enter a valid delivery email address.")
  }
  if (normalizeEmailDigestIntervalDays(profile.intervalDays, 0) !== profile.intervalDays) {
    throw new Error("Alert cadence must be a whole number from 1 to 30 days.")
  }
  if (normalizeEmailDigestLocalTime(profile.localTime, "") !== profile.localTime) {
    throw new Error("Alert delivery time must use HH:MM in 24-hour time.")
  }
  if (!isEmailDigestTimezone(profile.timezone) || profile.timezone.trim() !== profile.timezone) {
    throw new Error("Enter a valid IANA timezone.")
  }

  return normalized
}

export const saveCommunityAlertDeliveryProfile = async (
  profile: CommunityAlertDeliveryProfile,
): Promise<CommunityAlertDeliverySyncResult> => {
  const session = captureSession()
  requireSettingsHydrated(session)
  await hydrateCommunityAlertSettings(session.userPubkey, {force: true})
  assertSessionActive(session)
  requireSettingsHydrated(session)
  const normalizedProfile = validateDeliveryProfile(profile)
  const settings = await updateSettingsForSession(session, current => ({
    ...current,
    deliveryProfile: normalizedProfile,
  }))
  const errors: CommunityAlertDeliverySyncError[] = []
  const providerGroups = get(communityAlertProviderGroups)

  for (const communityAddress of Object.keys(settings.communities)) {
    await withCommunityAlertLifecycle(session, communityAddress, async () => {
      const registration = get(userCommunityAlertSettingsValues).communities[communityAddress]
      if (
        !registration?.enabled ||
        !registration.provider ||
        registration.pendingProvider ||
        !isCommunityAlertProviderAdvertised({
          communityAddress,
          provider: registration.provider,
          providerGroups,
        })
      ) {
        return
      }

      try {
        await publishSubscriptionForSession({
          session,
          communityAddress,
          provider: registration.provider,
          deliveryProfile: normalizedProfile,
          preferences: registration.preferences,
          minimumCreatedAt: registration.lastDeletionCreatedAt,
        })
      } catch (error) {
        assertSessionActive(session)
        errors.push({
          communityAddress,
          providerKey: getCommunityAlertServiceDescriptorKey(registration.provider),
          message: errorMessage(error),
        })
      }
    })
  }

  return {settings, errors}
}

export const disableCommunityAlerts = async (communityAddress: string) => {
  const session = captureSession()
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  if (!community) throw new Error("No saved community alert registration was found.")

  return withCommunityAlertLifecycle(session, community, async () => {
    const current = get(userCommunityAlertSettingsValues).communities[community]
    if (!current) throw new Error("No saved community alert registration was found.")
    const providers = uniqueProviders([
      current.provider,
      current.pendingProvider,
      ...(current.pendingCleanup || []),
    ])
    const savedProvider = current.provider || current.pendingProvider || providers[0]
    const pending = withLastDeletionCreatedAt(
      {
        enabled: false,
        ...(current.legacyCommunityId ? {legacyCommunityId: current.legacyCommunityId} : {}),
        ...(savedProvider ? {provider: savedProvider} : {}),
        ...(providers.length > 0 ? {pendingCleanup: providers} : {}),
        preferences: current.preferences,
      },
      current.lastDeletionCreatedAt,
    )
    await persistRegistration(session, community, pending)

    const failed: CommunityAlertService[] = []
    let firstError: unknown
    let latestDeletionCreatedAt = current.lastDeletionCreatedAt || 0
    for (const candidate of providers) {
      try {
        const deletion = await deleteRegistrationForSession({
          session,
          communityAddress: community,
          provider: candidate,
          persistDeletionCreatedAt: async createdAt => {
            latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, createdAt)
            await persistRegistration(
              session,
              community,
              withLastDeletionCreatedAt(pending, latestDeletionCreatedAt),
            )
          },
        })
        latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, deletion?.created_at || 0)
      } catch (error) {
        failed.push(candidate)
        firstError ||= error
      }
    }

    const disabled = withLastDeletionCreatedAt(
      {
        enabled: false,
        ...(failed.length > 0 && current.legacyCommunityId
          ? {legacyCommunityId: current.legacyCommunityId}
          : {}),
        ...(savedProvider ? {provider: savedProvider} : {}),
        ...(failed.length > 0 ? {pendingCleanup: failed} : {}),
        preferences: current.preferences,
        ...(firstError ? {lastError: errorMessage(firstError)} : {}),
      },
      latestDeletionCreatedAt,
    )
    await persistRegistration(session, community, disabled)
    if (firstError) throw firstError

    return disabled
  })
}

export const retryCommunityAlertCleanup = async (communityAddress: string) => {
  const session = captureSession()
  const community = parseCommunityDefinitionAddress(communityAddress)?.address || ""
  if (!community) return undefined

  return withCommunityAlertLifecycle(session, community, async () => {
    const current = get(userCommunityAlertSettingsValues).communities[community]
    if (!current?.pendingCleanup?.length) return current

    const remaining: CommunityAlertService[] = []
    let firstError: unknown
    let latestDeletionCreatedAt = current.lastDeletionCreatedAt || 0
    for (const provider of current.pendingCleanup) {
      try {
        const deletion = await deleteRegistrationForSession({
          session,
          communityAddress: community,
          provider,
          persistDeletionCreatedAt: async createdAt => {
            latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, createdAt)
            await persistRegistration(
              session,
              community,
              withLastDeletionCreatedAt(current, latestDeletionCreatedAt),
            )
          },
        })
        latestDeletionCreatedAt = Math.max(latestDeletionCreatedAt, deletion?.created_at || 0)
      } catch (error) {
        remaining.push(provider)
        firstError ||= error
      }
    }

    const currentProviderKey = current.provider
      ? getCommunityAlertServiceDescriptorKey(current.provider)
      : ""
    const currentProviderWasPending = current.pendingCleanup.some(
      provider => getCommunityAlertServiceDescriptorKey(provider) === currentProviderKey,
    )
    const activeProviderStillPending = remaining.some(
      provider => getCommunityAlertServiceDescriptorKey(provider) === currentProviderKey,
    )
    const next = withLastDeletionCreatedAt(
      {
        ...current,
        enabled: current.enabled && (!currentProviderWasPending || activeProviderStillPending),
        ...(remaining.length > 0 ? {pendingCleanup: remaining} : {}),
        ...(firstError ? {lastError: errorMessage(firstError)} : {}),
      },
      latestDeletionCreatedAt,
    )
    if (remaining.length === 0) delete next.pendingCleanup
    if (!firstError) delete next.lastError
    await persistRegistration(session, community, next)
    if (firstError) throw firstError

    return next
  })
}

export const makeCommunityAlertStatusFilter = (
  communityAddress: string,
  userPubkey: string,
  provider: CommunityAlertService,
) => ({
  kinds: [COMMUNITY_ALERTS_STATUS_KIND],
  authors: [provider.servicePubkey],
  "#d": [getCommunityAlertStatusDtag(communityAddress, userPubkey)],
  "#p": [userPubkey],
})

export const makeCommunityAlertSubscriptionFilter = (
  communityAddress: string,
  userPubkey: string,
  provider: CommunityAlertService,
) => ({
  kinds: [COMMUNITY_ALERTS_SUBSCRIPTION_KIND],
  authors: [userPubkey],
  "#d": [getCommunityAlertSubscriptionDtag(communityAddress)],
  "#p": [provider.servicePubkey],
})
