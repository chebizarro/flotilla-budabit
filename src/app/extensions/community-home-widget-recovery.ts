import type {Writable} from "svelte/store"
import type {CommunitySharedConfigDescriptorAuthority} from "./community-shared-config"
import type {SmartWidgetEvent} from "./types"

export type CommunityHomeWidgetRecoveryState = {
  communityAddress: string
  curatedWidgets: SmartWidgetEvent[]
  sharedConfigEvents: any[]
  authorizedPubkeys: Set<string>
  descriptorAuthorities: CommunitySharedConfigDescriptorAuthority[]
}

export type CommunityHomeWidgetRecoveryStore = Writable<CommunityHomeWidgetRecoveryState>

export const emptyCommunityHomeWidgetRecoveryState = (): CommunityHomeWidgetRecoveryState => ({
  communityAddress: "",
  curatedWidgets: [],
  sharedConfigEvents: [],
  authorizedPubkeys: new Set(),
  descriptorAuthorities: [],
})
