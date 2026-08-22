<script lang="ts">
  import type {Snippet} from "svelte"

  interface Props {
    label?: Snippet
    secondary?: Snippet
    input?: Snippet
    info?: Snippet
    error?: string
    for?: string
    [key: string]: any
  }

  const {label, secondary, input, info, error, for: fieldFor, ...props}: Props = $props()
</script>

<div class="flex flex-col gap-2 {props.class}">
  <div class="flex items-center justify-between">
    {#if label}
      <label class="flex items-center gap-2 font-bold" for={fieldFor}>
        {@render label()}
      </label>
    {/if}
    {#if secondary}
      <label class="flex items-center gap-2">
        {@render secondary()}
      </label>
    {/if}
  </div>
  {@render input?.()}
  {#if info}
    <p class="text-sm opacity-50" id={fieldFor ? `${fieldFor}-hint` : undefined}>
      {@render info()}
    </p>
  {/if}
  {#if error}
    <p
      class="text-sm font-medium text-error"
      id={fieldFor ? `${fieldFor}-error` : undefined}
      role="alert">
      {error}
    </p>
  {/if}
</div>
