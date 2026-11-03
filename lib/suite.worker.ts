import { handleJob, type Job } from './harness'

// Runs user code off the main thread; the pool terminates this worker if a job runs past its timeout.
const scope = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(message: unknown): void }
scope.onmessage = (e) => scope.postMessage(handleJob(e.data))
scope.postMessage({ ready: true })
