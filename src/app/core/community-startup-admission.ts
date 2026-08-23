export type CommunityMaintenanceLane = "history" | "follow-up" | "deletes"

export type CommunityMaintenanceAdmissionState = Record<CommunityMaintenanceLane, boolean>

type ScheduleTask = (run: () => void) => () => void

type CommunityMaintenanceAdmissionOptions = {
  onChange: (state: CommunityMaintenanceAdmissionState) => void
  scheduleTask?: ScheduleTask
}

const emptyState = (): CommunityMaintenanceAdmissionState => ({
  history: false,
  "follow-up": false,
  deletes: false,
})

const nextLane: Partial<Record<CommunityMaintenanceLane, CommunityMaintenanceLane>> = {
  history: "follow-up",
  "follow-up": "deletes",
}

export const createCommunityMaintenanceAdmission = ({
  onChange,
  scheduleTask = run => {
    const timer = setTimeout(run, 0)
    return () => clearTimeout(timer)
  },
}: CommunityMaintenanceAdmissionOptions) => {
  let key = ""
  let generation = 0
  let state = emptyState()
  let cancelQueuedTask: (() => void) | undefined
  let queuedLane: CommunityMaintenanceLane | undefined

  const publish = () => onChange({...state})

  const cancelQueued = () => {
    cancelQueuedTask?.()
    cancelQueuedTask = undefined
    queuedLane = undefined
  }

  const queue = (lane: CommunityMaintenanceLane, expectedGeneration: number) => {
    if (!key || state[lane] || queuedLane === lane) return

    cancelQueued()
    queuedLane = lane
    cancelQueuedTask = scheduleTask(() => {
      cancelQueuedTask = undefined
      queuedLane = undefined
      if (!key || generation !== expectedGeneration) return

      state = {...state, [lane]: true}
      publish()
    })
  }

  const reset = () => {
    generation += 1
    key = ""
    cancelQueued()
    state = emptyState()
    publish()
  }

  const start = (nextKey: string) => {
    if (!nextKey) {
      reset()
      return
    }
    if (key === nextKey) return

    generation += 1
    key = nextKey
    cancelQueued()
    state = emptyState()
    publish()
    queue("history", generation)
  }

  const settle = (settledKey: string, lane: CommunityMaintenanceLane) => {
    if (!settledKey || settledKey !== key || !state[lane]) return

    const next = nextLane[lane]
    if (next) queue(next, generation)
  }

  return {
    getKey: () => key,
    reset,
    settle,
    start,
  }
}
