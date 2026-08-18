import {normalizePubkey} from "@app/core/community"
import type {SmartWidgetEvent} from "@app/extensions/types"

export const selectDefaultCommunityWidgets = (
  widgets: SmartWidgetEvent[],
  controllerPubkey?: string,
) => {
  const ownerPubkey = normalizePubkey(controllerPubkey || "")

  return ownerPubkey
    ? widgets.filter(widget => normalizePubkey(widget.pubkey || "") === ownerPubkey)
    : []
}
