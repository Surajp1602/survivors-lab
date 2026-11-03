'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './motion-prefs'

/** Counts from the previous value to `value`. Tabular figures in the parent keep the width steady. */
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    let frame = 0
    const began = performance.now()
    const tick = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - began) / duration)
      const next = Math.round(start + (value - start) * (1 - (1 - t) ** 3))
      from.current = next
      setShown(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduced])
  return <span aria-hidden="true">{shown}</span>
}
