// worker_threads counterpart of lib/suite.worker.ts. Node loads harness.ts with its built-in type stripping.
import { parentPort } from 'node:worker_threads'
import { handleJob } from '../lib/harness.ts'

parentPort.on('message', (job) => parentPort.postMessage(handleJob(job)))
parentPort.postMessage({ ready: true })
