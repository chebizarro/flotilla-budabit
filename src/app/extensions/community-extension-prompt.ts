import {localStorageProvider, synced} from "@welshman/store"
import {get} from "svelte/store"
import {
  normalizePubkey,
  parseCommunityDefinitionAddress,
  type CommunityPointer,
} from "@app/core/community"

export const COMMUNITY_EXTENSION_PROMPT_KEY = "budabit/community-extension-prompt"

export type CommunityExtensionPromptState = {
  version: 2
  pubkey: string
  dismissedCommunityAddresses: string[]
}

export const defaultCommunityExtensionPromptState: CommunityExtensionPromptState = {
  version: 2,
  pubkey: "",
  dismissedCommunityAddresses: [],
}

export const normalizeCommunityExtensionPromptState = (
  value: unknown,
): CommunityExtensionPromptState => {
  if (!value || typeof value !== "object" || (value as {version?: unknown}).version !== 2) {
    return {...defaultCommunityExtensionPromptState}
  }
  const source = value as Partial<CommunityExtensionPromptState>
  const userPubkey = normalizePubkey(source.pubkey || "")
  const dismissedCommunityAddresses = Array.from(
    new Set(
      (Array.isArray(source.dismissedCommunityAddresses)
        ? source.dismissedCommunityAddresses
        : []
      ).flatMap(address => {
        const pointer = parseCommunityDefinitionAddress(address)
        return pointer ? [pointer.address] : []
      }),
    ),
  )

  return {version: 2, pubkey: userPubkey, dismissedCommunityAddresses}
}

export const communityExtensionPrompt = synced({
  key: COMMUNITY_EXTENSION_PROMPT_KEY,
  defaultValue: defaultCommunityExtensionPromptState,
  storage: localStorageProvider,
})

export const ensureCommunityExtensionPromptLogin = (userPubkey: string) => {
  const normalizedPubkey = normalizePubkey(userPubkey)
  if (!normalizedPubkey) return

  communityExtensionPrompt.update(state =>
    state.pubkey === normalizedPubkey
      ? state
      : {version: 2, pubkey: normalizedPubkey, dismissedCommunityAddresses: []},
  )
}

export const clearCommunityExtensionPromptLogin = () => {
  communityExtensionPrompt.set(defaultCommunityExtensionPromptState)
}

export const dismissCommunityExtensionPromptState = (
  state: CommunityExtensionPromptState | undefined,
  userPubkey: string,
  community: CommunityPointer,
) => {
  const normalizedUser = normalizePubkey(userPubkey)
  const pointer = parseCommunityDefinitionAddress(community.address)
  if (!normalizedUser || !pointer) return normalizeCommunityExtensionPromptState(state)
  const current = normalizeCommunityExtensionPromptState(state)
  const dismissed = current.pubkey === normalizedUser ? current.dismissedCommunityAddresses : []

  return {
    version: 2 as const,
    pubkey: normalizedUser,
    dismissedCommunityAddresses: Array.from(new Set([...dismissed, pointer.address])),
  }
}

export const dismissCommunityExtensionPrompt = (userPubkey: string, community: CommunityPointer) =>
  communityExtensionPrompt.update(state =>
    dismissCommunityExtensionPromptState(state, userPubkey, community),
  )

export const isCommunityExtensionPromptDismissed = (
  userPubkey: string,
  community: CommunityPointer,
  state = get(communityExtensionPrompt),
) => {
  const normalizedUser = normalizePubkey(userPubkey)
  const pointer = parseCommunityDefinitionAddress(community.address)
  const current = normalizeCommunityExtensionPromptState(state)

  return Boolean(
    normalizedUser &&
    pointer &&
    current.pubkey === normalizedUser &&
    current.dismissedCommunityAddresses.includes(pointer.address),
  )
}
