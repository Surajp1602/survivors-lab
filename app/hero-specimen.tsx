'use client'

import { useEffect, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { createMutants } from '@/lib/engine'
import { heroDemo } from '@/lib/presets'
import { useReducedMotion } from './motion-prefs'

const mutants = createMutants(heroDemo.specimen.fn)
const STEP_MS = 900
const HOLD_STEPS = 4

/** Specimen 01's mutant cells filling in, in the results grid's cell styles. Reduced motion shows the final state. */
export function HeroSpecimen() {
  const reduced = useReducedMotion()
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setStep((s) => (s + 1) % (mutants.length + HOLD_STEPS + 1)), STEP_MS)
    return () => clearInterval(timer)
  }, [reduced])
  const filled = reduced ? mutants.length : Math.min(step, mutants.length)
  const survivors = heroDemo.survived.filter(Boolean).length
  return (
    <figure className="hero-specimen" aria-label={`Specimen ${heroDemo.specimen.id}, ${heroDemo.specimen.name}: ${mutants.length} mutants, ${survivors} survive the tests`}>
      <figcaption className="field-label">Specimen {heroDemo.specimen.id} · {heroDemo.specimen.name}</figcaption>
      <ul className="hero-rows" aria-hidden="true">
        {mutants.map((m, i) => {
          const done = i < filled
          const alive = heroDemo.survived[i]
          return (
            <li key={m.key}>
              <span className={`mutant-cell ${done ? (alive ? 'survived' : 'killed') : ''}`}>{done && (alive ? <Circle size={10} fill="currentColor"/> : <Check size={14}/>)}</span>
              <code>{m.before.trim()} → {m.after.trim()}</code>
            </li>
          )
        })}
      </ul>
      <p className="hero-tally" aria-hidden="true">{filled} / {mutants.length} tested · {heroDemo.survived.slice(0, filled).filter(Boolean).length} survived</p>
    </figure>
  )
}
