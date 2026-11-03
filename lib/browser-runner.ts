import { createPool, type Runner } from './runner'

/** Web Worker pool: up to min(4, hardwareConcurrency) workers. */
export function createBrowserRunner(): Runner {
  const size = Math.min(4, navigator.hardwareConcurrency || 2)
  return createPool(() => {
    const worker = new Worker(new URL('./suite.worker.ts', import.meta.url), { type: 'module' })
    return {
      post: (job) => worker.postMessage(job),
      onMessage: (cb) => { worker.onmessage = (e) => cb(e.data) },
      onError: (cb) => { worker.onerror = (e) => { e.preventDefault(); cb(e.message) } },
      terminate: () => worker.terminate(),
    }
  }, size)
}
