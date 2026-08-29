<style lang="postcss">
  .room-item-content :global(.markdown) {
    @apply text-sm leading-normal;
  }

  .room-item-content :global(.markdown > p) {
    @apply my-1;
  }

  .room-item-content :global(.markdown > :first-child) {
    margin-top: 0;
  }

  .room-item-content :global(.markdown > :last-child) {
    margin-bottom: 0;
  }

  .room-item-content :global(.markdown > p > button) {
    @apply my-1;
  }

  .room-item-content :global([data-quoted-event-preview]) {
    @apply line-clamp-2 max-h-12;
  }

  .room-item-content :global(.content-link-block) {
    max-width: min(100%, 28rem);
  }

  .room-item-content :global([data-content-media]),
  .room-item-content :global([data-markdown-image]) {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: min(16rem, 35vh);
    object-fit: contain;
  }
</style>

<script lang="ts">
  import cx from "classnames"
  import type {ComponentProps} from "svelte"
  import {goto} from "$app/navigation"
  import {MESSAGE} from "@welshman/util"
  import {isMobile} from "@lib/html"
  import NoteContent from "@app/components/NoteContent.svelte"

  const props: ComponentProps<typeof NoteContent> = $props()

  const path = undefined

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, textarea, select, [role='button'], [data-stop-link]"))

  const openPath = (event: MouseEvent) => {
    if (!path || isInteractiveTarget(event.target)) return

    goto(path)
  }

  const openPathFromKeyboard = (event: KeyboardEvent) => {
    if (!path || isInteractiveTarget(event.target)) return
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    goto(path)
  }
</script>

<div
  class={cx("room-item-content w-full min-w-0 text-sm", {
    "card2 card2-sm bg-alt": props.event.kind !== MESSAGE,
  })}>
  {#if path && !isMobile}
    <div
      role="link"
      tabindex="0"
      class="block w-full min-w-0 cursor-pointer"
      onclick={openPath}
      onkeydown={openPathFromKeyboard}>
      <NoteContent {...props} />
    </div>
  {:else}
    <NoteContent {...props} />
  {/if}
</div>
