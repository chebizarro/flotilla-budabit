<script lang="ts">
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import NoteContent from "@app/components/NoteContent.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import {publishReactionDeleteOperation, publishReactionOperation} from "@app/core/commands"

  const {url, event} = $props()

  const deleteReaction = async (reaction: TrustedEvent) =>
    publishReactionDeleteOperation({reaction, relays: [url]})

  const createReaction = async (template: EventContent) =>
    publishReactionOperation({...template, event, relays: [url]})

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReactionOperation({
      event,
      content: emoji.unicode,
      relays: [url],
    })
</script>

<NoteCard {event} {url} class="card2 bg-alt">
  <NoteContent {event} expandMode="inline" />
  <div class="flex w-full justify-between gap-2">
    <ReactionSummary {url} {event} {deleteReaction} {createReaction} reactionClass="tooltip-right">
      <EmojiButton
        {onEmoji}
        class="btn btn-neutral btn-xs h-[26px] rounded-box"
        aria-label="Add reaction">
        <Icon icon={SmileCircle} size={4} />
      </EmojiButton>
    </ReactionSummary>
  </div>
</NoteCard>
