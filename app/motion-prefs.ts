import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(query)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** True when the viewer asked for reduced motion. Assumed true on the server so nothing animates before hydration. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true)
