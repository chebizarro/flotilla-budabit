import {describe, expect, it, vi} from "vitest"
import {
  createCommunityMaintenanceAdmission,
  type CommunityMaintenanceAdmissionState,
} from "./community-startup-admission"

const makeHarness = () => {
  const tasks: Array<() => void> = []
  const states: CommunityMaintenanceAdmissionState[] = []
  const admission = createCommunityMaintenanceAdmission({
    onChange: state => states.push(state),
    scheduleTask: run => {
      tasks.push(run)
      return () => {
        const index = tasks.indexOf(run)
        if (index >= 0) tasks.splice(index, 1)
      }
    },
  })
  const runNext = () => tasks.shift()?.()

  return {admission, states, tasks, runNext}
}

describe("community maintenance admission", () => {
  it("admits each maintenance lane only after the prior lane settles", () => {
    const {admission, states, tasks, runNext} = makeHarness()

    admission.start("community-a")
    expect(states.at(-1)).toEqual({
      history: false,
      "follow-up": false,
      deletes: false,
      menu: false,
    })
    expect(tasks).toHaveLength(1)

    runNext()
    expect(states.at(-1)).toEqual({history: true, "follow-up": false, deletes: false, menu: false})

    admission.settle("community-a", "history")
    expect(states.at(-1)?.["follow-up"]).toBe(false)
    runNext()
    expect(states.at(-1)).toEqual({history: true, "follow-up": true, deletes: false, menu: false})

    admission.settle("community-a", "follow-up")
    expect(states.at(-1)?.deletes).toBe(false)
    runNext()
    expect(states.at(-1)).toEqual({history: true, "follow-up": true, deletes: true, menu: false})

    admission.settle("community-a", "deletes")
    expect(states.at(-1)?.menu).toBe(false)
    runNext()
    expect(states.at(-1)).toEqual({history: true, "follow-up": true, deletes: true, menu: true})
  })

  it("cancels queued work when the semantic generation changes", () => {
    const {admission, states, tasks, runNext} = makeHarness()

    admission.start("community-a")
    admission.start("community-b")
    expect(tasks).toHaveLength(1)
    runNext()

    expect(admission.getKey()).toBe("community-b")
    expect(states.at(-1)).toEqual({history: true, "follow-up": false, deletes: false, menu: false})
    admission.settle("community-a", "history")
    expect(tasks).toHaveLength(0)
  })

  it("does not let duplicate settlement queue duplicate lanes", () => {
    const {admission, tasks, runNext} = makeHarness()

    admission.start("community-a")
    runNext()
    admission.settle("community-a", "history")
    admission.settle("community-a", "history")

    expect(tasks).toHaveLength(1)
  })

  it("clears queued admission and state on reset", () => {
    const onChange = vi.fn()
    const cancel = vi.fn()
    const admission = createCommunityMaintenanceAdmission({
      onChange,
      scheduleTask: () => cancel,
    })

    admission.start("community-a")
    admission.reset()

    expect(cancel).toHaveBeenCalledOnce()
    expect(admission.getKey()).toBe("")
    expect(onChange).toHaveBeenLastCalledWith({
      history: false,
      "follow-up": false,
      deletes: false,
      menu: false,
    })
  })
})
