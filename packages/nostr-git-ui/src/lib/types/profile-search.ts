import type { Readable } from "svelte/store";

export interface ProfileSearchContext {
  communityAddress?: string;
}

export type ProfileSearchUpdateSignal = Readable<unknown>;
