import {hexToBytes, bytesToHex} from "@noble/hashes/utils"
import * as nip19 from "nostr-tools/nip19"
import {range, DAY} from "@welshman/lib"
import { getEventTags } from "@welshman/util"

export const displayList = <T>(xs: T[], conj = "and", n = 6, locale = "en-US") => {
  const stringItems = xs.map(String)

  if (xs.length > n + 2) {
    const formattedList = new Intl.ListFormat(locale, {style: "long", type: "unit"}).format(
      stringItems.slice(0, n),
    )

    return `${formattedList}, ${conj} ${xs.length - n} others`
  }

  return new Intl.ListFormat(locale, {style: "long", type: "conjunction"}).format(stringItems)
}

export const nsecEncode = (secret: string) => nip19.nsecEncode(hexToBytes(secret))

export const nsecDecode = (nsec: string) => {
  const {type, data} = nip19.decode(nsec)

  if (type !== "nsec") throw new Error(`Invalid nsec: ${nsec}`)

  return bytesToHex(data)
}

export const day = (seconds: number) => Math.floor(seconds / DAY)

export const daysBetween = (start: number, end: number) => [...range(start, end, DAY)].map(day)


export const FREELANCE_JOB = 32767
  // GIT_REPOSITORY is mistakenly defined in welshman as 30403 which
  // is a Draft Classified listing (nip99) kind in reality.
export const GIT_REPO = 30617
export const GIT_REPO_BOOKMARK_DTAG = 'followed_git_repos'

export enum GitIssueStatus {
  OPEN = "Open",
  CLOSED = "Closed",
  RESOLVED = "Resolved",
  DRAFT = "Draft"
}

export const getRootEventTagValue = (tags: string[][]): string | undefined => {
  return getEventTags(tags).find(t => t[3]==='root')?.[1]
}
