import {normalizePubkey} from "@app/core/community"
import type {CommunityEventDescriptor} from "./types"

export type CommunitySharedConfigDescriptorAuthority = {
  descriptor: CommunityEventDescriptor
  moderatorPubkeys: Iterable<string>
}

export const getCommunitySharedConfigDescriptorKey = (descriptor: CommunityEventDescriptor) =>
  `${descriptor.kind}:${descriptor.subtype?.trim() || ""}`

const parseDescriptorTags = (event: {tags?: string[][]}) => {
  const tags = (event.tags || []).filter(tag => tag[0] === "descriptor")
  const descriptors = new Map<string, CommunityEventDescriptor>()

  for (const tag of tags) {
    const kind = Number(tag[1])
    if (!Number.isInteger(kind) || kind < 0) return {declared: true, valid: false, descriptors: []}
    const subtype = tag[2]?.trim()
    const descriptor = subtype ? {kind, subtype} : {kind}
    descriptors.set(getCommunitySharedConfigDescriptorKey(descriptor), descriptor)
  }

  return {declared: tags.length > 0, valid: true, descriptors: Array.from(descriptors.values())}
}

export const isAuthorizedCommunitySharedConfigEvent = ({
  event,
  descriptorAuthorities,
  requireExactDescriptors = false,
}: {
  event: {pubkey?: string; tags?: string[][]}
  descriptorAuthorities: CommunitySharedConfigDescriptorAuthority[]
  requireExactDescriptors?: boolean
}) => {
  const author = normalizePubkey(event.pubkey || "")
  if (!author) return false

  const parsed = parseDescriptorTags(event)
  if (!parsed.declared) return false
  if (!parsed.valid) return false

  const authorityByDescriptor = new Map(
    descriptorAuthorities.map(({descriptor, moderatorPubkeys}) => [
      getCommunitySharedConfigDescriptorKey(descriptor),
      new Set(Array.from(moderatorPubkeys, normalizePubkey).filter(Boolean)),
    ]),
  )
  const declaredKeys = new Set(parsed.descriptors.map(getCommunitySharedConfigDescriptorKey))

  if (
    requireExactDescriptors &&
    (declaredKeys.size !== authorityByDescriptor.size ||
      Array.from(authorityByDescriptor.keys()).some(key => !declaredKeys.has(key)))
  ) {
    return false
  }

  return parsed.descriptors.some(descriptor =>
    authorityByDescriptor.get(getCommunitySharedConfigDescriptorKey(descriptor))?.has(author),
  )
}
