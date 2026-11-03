import { Worker } from 'node:worker_threads'
import { createPool, TIMEOUT_MS, type Runner } from '@/lib/runner'

/** The same pool the browser uses, backed by worker_threads. */
export function createNodeRunner(size = 4, timeoutMs = TIMEOUT_MS): Runner {
  return createPool(() => {
    const worker = new Worker(new URL('./node-worker.mjs', import.meta.url), { execArgv: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'] })
    return {
      post: (job) => worker.postMessage(job),
      onMessage: (cb) => { worker.on('message', cb) },
      onError: (cb) => { worker.on('error', (e) => cb(e.message)) },
      terminate: () => { void worker.terminate() },
    }
  }, size, timeoutMs)
}
