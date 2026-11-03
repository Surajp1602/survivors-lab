import type { EvalResult, Job, SuiteResult } from './harness'

export const TIMEOUT_MS = 1500

export type SuiteOutcome = SuiteResult & { timedOut?: true; cancelled?: true }
export type EvalOutcome = EvalResult & { timedOut?: true; cancelled?: true }

/** Everything that executes user code goes through this interface, so it never runs on the caller's thread. */
export interface Runner {
  suite(code: string, names: string[], testsCode: string): Promise<SuiteOutcome>
  evaluate(code: string, call: string): Promise<EvalOutcome>
  /** Drop queued jobs (they resolve as cancelled); running jobs finish or time out. */
  cancelPending(): void
  dispose(): void
}

/**
 * A worker as the pool sees it: Web Worker in the browser, worker_threads in Node.
 * The worker posts `{ ready: true }` once loaded, then answers each job with exactly one message.
 */
export type WorkerHandle = {
  post(job: Job): void
  onMessage(cb: (data: unknown) => void): void
  onError(cb: (message: string) => void): void
  terminate(): void
}

type Task = { job: Job; resolve: (r: SuiteOutcome | EvalOutcome) => void }
type Slot = { handle: WorkerHandle; ready: boolean; task?: Task; timer?: ReturnType<typeof setTimeout> }

const failed = (job: Job, extra: { timedOut?: true; cancelled?: true }, message: string): SuiteOutcome | EvalOutcome =>
  job.kind === 'suite' ? { ok: false, count: 0, message, ...extra } : { throws: true, reached: false, ...extra }

/**
 * A fixed-size pool. Each job gets `timeoutMs` once it reaches a ready worker; a job that runs over is
 * reported as timed out and its worker is terminated and replaced, so an infinite loop costs one timeout.
 */
export function createPool(spawn: () => WorkerHandle, size: number, timeoutMs = TIMEOUT_MS): Runner {
  const queue: Task[] = []
  const slots: Slot[] = []
  let disposed = false

  const finish = (slot: Slot, result: SuiteOutcome | EvalOutcome) => {
    const task = slot.task
    clearTimeout(slot.timer)
    slot.task = undefined
    task?.resolve(result)
    pump()
  }

  const replace = (slot: Slot) => {
    slot.handle.terminate()
    const index = slots.indexOf(slot)
    if (index >= 0 && !disposed) slots[index] = start()
  }

  const start = (): Slot => {
    const slot: Slot = { handle: spawn(), ready: false }
    slot.handle.onMessage((data) => {
      if (slots.indexOf(slot) === -1) return
      if ((data as { ready?: boolean })?.ready) { slot.ready = true; pump(); return }
      finish(slot, data as SuiteOutcome | EvalOutcome)
    })
    slot.handle.onError((message) => {
      if (slots.indexOf(slot) === -1) return
      const task = slot.task
      replace(slot)
      if (task) { clearTimeout(slot.timer); task.resolve(failed(task.job, {}, `The test worker crashed: ${message}`)); pump() }
    })
    return slot
  }

  function pump() {
    for (const slot of slots) {
      if (!slot.ready || slot.task || !queue.length) continue
      const task = queue.shift()!
      slot.task = task
      slot.timer = setTimeout(() => {
        replace(slot)
        task.resolve(failed(task.job, { timedOut: true }, `timed out after ${timeoutMs} ms`))
        pump()
      }, timeoutMs)
      slot.handle.post(task.job)
    }
  }

  for (let i = 0; i < Math.max(1, size); i++) slots.push(start())

  const enqueue = (job: Job) => new Promise<SuiteOutcome | EvalOutcome>((resolve) => {
    if (disposed) return resolve(failed(job, { cancelled: true }, 'cancelled'))
    queue.push({ job, resolve })
    pump()
  })

  return {
    suite: (code, names, testsCode) => enqueue({ kind: 'suite', code, names, testsCode }) as Promise<SuiteOutcome>,
    evaluate: (code, call) => enqueue({ kind: 'eval', code, call }) as Promise<EvalOutcome>,
    cancelPending: () => { for (const task of queue.splice(0)) task.resolve(failed(task.job, { cancelled: true }, 'cancelled')) },
    dispose: () => {
      disposed = true
      for (const task of queue.splice(0)) task.resolve(failed(task.job, { cancelled: true }, 'cancelled'))
      for (const slot of slots.splice(0)) { clearTimeout(slot.timer); slot.task?.resolve(failed(slot.task.job, { cancelled: true }, 'cancelled')); slot.handle.terminate() }
    },
  }
}
