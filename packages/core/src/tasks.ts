import { Effect } from 'effect'
import { CurrentActor, systemActor } from './authz.ts'
import type { Module, Task } from './module.ts'

const minute = 60_000
const tick = 5 * minute
const periods: Record<Task['every'], number> = {
  '5m': tick,
  '1h': 60 * minute,
  '1d': 1440 * minute,
}

export class TaskFailures extends Error {
  override name = 'TaskFailures'
}

/**
 * Runs the tasks due at `scheduledTime`: those whose UTC bucket (5 minutes, hour, day) starts in
 * this tick's 5-minute slot. Missed ticks are not caught up. Tasks run one after another as the
 * system actor; a failure is logged, the rest still run, and the run fails at the end.
 */
export const runDueTasks = (modules: ReadonlyArray<Module>, scheduledTime: number) =>
  Effect.gen(function* () {
    const slot = Math.floor(scheduledTime / tick) * tick
    const failed: Array<string> = []
    for (const m of modules)
      for (const task of m.tasks) {
        if (slot % periods[task.every] !== 0) continue
        const key = `${m.id}.${task.name}`
        yield* task.run.pipe(
          Effect.provideService(CurrentActor, systemActor(`Task: ${key}`)),
          Effect.withSpan(`task ${key}`),
          Effect.catchCause((cause) => {
            failed.push(key)
            return Effect.logError(`task ${key} failed`, cause)
          }),
        )
      }
    if (failed.length > 0) yield* Effect.die(new TaskFailures(`tasks failed: ${failed.join(', ')}`))
  })
