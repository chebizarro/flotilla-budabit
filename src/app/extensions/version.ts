/**
 * Compare two semantic version strings.
 * Returns:
 *  1 if leftVersion > rightVersion
 *  0 if leftVersion === rightVersion
 * -1 if leftVersion < rightVersion
 */
export function compareVersions(
  leftVersion: string | undefined,
  rightVersion: string | undefined,
): number {
  if (!leftVersion && !rightVersion) return 0
  if (!leftVersion) return -1
  if (!rightVersion) return 1

  // Remove leading 'v' if present
  const cleanLeft = leftVersion.replace(/^v/, "")
  const cleanRight = rightVersion.replace(/^v/, "")

  const leftParts = cleanLeft.split(".").map(part => parseInt(part, 10) || 0)
  const rightParts = cleanRight.split(".").map(part => parseInt(part, 10) || 0)

  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let i = 0; i < maxLength; i++) {
    const leftPart = leftParts[i] || 0
    const rightPart = rightParts[i] || 0

    if (leftPart > rightPart) return 1
    if (leftPart < rightPart) return -1
  }

  return 0
}

/**
 * Check if an update is available by comparing installed vs available version.
 */
export function hasUpdate(
  installedVersion: string | undefined,
  availableVersion: string | undefined,
): boolean {
  return compareVersions(availableVersion, installedVersion) > 0
}
