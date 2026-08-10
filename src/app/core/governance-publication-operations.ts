const MODERATOR_INVITE_RESPONSE_PREFIX = "moderator-invite-response:"
const REPORT_REVIEW_PREFIX = "report-review:"

export const getModeratorInviteResponseSemanticKey = (address: string) =>
  `${MODERATOR_INVITE_RESPONSE_PREFIX}${address}`

export const getReportReviewSemanticKey = (reportId: string) => `${REPORT_REVIEW_PREFIX}${reportId}`
