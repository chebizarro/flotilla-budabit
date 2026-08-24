const MODERATOR_INVITE_RESPONSE_PREFIX = "moderator-invite-response:"
const REPORT_REVIEW_PREFIX = "report-review:"
const MEMBERSHIP_CHANGE_PREFIX = "community-membership-change:"
const DEFINITION_UPDATE_PREFIX = "community-definition-update:"
const ADMISSION_REVIEW_PREFIX = "community-admission-review:"

export const getModeratorInviteResponseSemanticKey = (address: string) =>
  `${MODERATOR_INVITE_RESPONSE_PREFIX}${address}`

export const getReportReviewSemanticKey = (reportId: string) => `${REPORT_REVIEW_PREFIX}${reportId}`

export const getCommunityMembershipChangeSemanticKey = (
  profileListAddress: string,
  memberPubkey: string,
) => `${MEMBERSHIP_CHANGE_PREFIX}${profileListAddress}:${memberPubkey}`

export const getCommunityDefinitionUpdateSemanticKey = (definitionAddress: string) =>
  `${DEFINITION_UPDATE_PREFIX}${definitionAddress}`

export const getCommunityAdmissionReviewSemanticKey = (responseId: string) =>
  `${ADMISSION_REVIEW_PREFIX}${responseId}`
