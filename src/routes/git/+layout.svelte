<script lang="ts">
  import {page} from "$app/stores"
  import type {Snippet} from "svelte"
  import {setContext} from "svelte"
  import {writable} from "svelte/store"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import {activeCommunitySession} from "@app/core/community-state"
  import {REPO_LIST_HYDRATION_READY_KEY, repoAnnouncementRelaysStore} from "@app/core/git-state"
  import {preloadRepositoryList} from "@app/core/repo-list-preload"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()
  const activeCommunityPubkey = $derived($activeCommunitySession?.communityPubkey || "")
  const repoListHydrationReady = writable(false)

  setContext(REPO_LIST_HYDRATION_READY_KEY, repoListHydrationReady)

  $effect(() => {
    const isRepositoryList = $page.route.id === "/git"
    const relays = $repoAnnouncementRelaysStore

    repoListHydrationReady.set(false)
    if (!isRepositoryList) return

    const controller = new AbortController()
    void preloadRepositoryList({
      relays,
      signal: controller.signal,
      onHydrated: () => {
        if (!controller.signal.aborted) repoListHydrationReady.set(true)
      },
      onHydrationError: error => {
        console.warn("[repo-list] Failed to hydrate eligible repository announcements", error)
      },
    }).catch(error => {
      if (!controller.signal.aborted) {
        console.warn("[repo-list] Failed to preload repository announcements", error)
      }
    })

    return () => {
      controller.abort()
      repoListHydrationReady.set(false)
    }
  })
</script>

{#if activeCommunityPubkey}
  <SecondaryNav>
    <CommunityMenu community={activeCommunityPubkey} />
  </SecondaryNav>
{/if}

{@render children?.()}
