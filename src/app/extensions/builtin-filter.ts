import {normalizePubkey} from "@app/core/community"
import type {SmartWidgetEvent} from "@app/extensions/types"

export const selectDefaultCommunityWidgets = (
  widgets: SmartWidgetEvent[],
  ownerPubkey?: string,
) => {
  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey || "")

  return normalizedOwnerPubkey
    ? widgets.filter(widget => normalizePubkey(widget.pubkey || "") === normalizedOwnerPubkey)
    : []
}
