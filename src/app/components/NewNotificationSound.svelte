<script lang="ts">
  import {onMount} from "svelte"
  import {userSettingsValues} from "@app/core/state"
  import {notifications} from "../util/notifications"

  let audioElement: HTMLAudioElement

  let enabled = $state(false)

  let notificationCount = $state($notifications.size)

  const playSound = () => {
    if (enabled && $userSettingsValues.play_notification_sound) {
      void audioElement?.play().catch(() => undefined)
    }
  }

  onMount(() => {
    const handleVisibilityChange = () => {
      enabled = document.hidden
    }
    handleVisibilityChange()
    document.addEventListener("visibilitychange", handleVisibilityChange)

    const unsubscribeNotifications = notifications.subscribe(notifications => {
      if (notifications.size > notificationCount) {
        playSound()
      }

      notificationCount = notifications.size
    })

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      unsubscribeNotifications()
    }
  })
</script>

<audio bind:this={audioElement} preload="none" src="/new-notification-3-398649.mp3"></audio>
