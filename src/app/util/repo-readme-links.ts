const URI_SCHEME = /^[a-z][a-z\d+.-]*:/i

export const resolveRepoReadmeHref = (href: string, repoBasePath: string): string => {
  if (!href || href.startsWith("#") || href.startsWith("/") || URI_SCHEME.test(href)) {
    return href
  }

  try {
    const resolved = new URL(href, "https://repo.invalid/")
    const path = decodeURIComponent(resolved.pathname.slice(1))
    if (!path) return href

    const queryKey = resolved.pathname.endsWith("/") ? "dir" : "path"
    return `${repoBasePath.replace(/\/+$/, "")}/code?${queryKey}=${encodeURIComponent(path)}${resolved.hash}`
  } catch {
    return href
  }
}
